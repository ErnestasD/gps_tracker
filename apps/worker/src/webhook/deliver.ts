import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'

/**
 * POST a webhook to an ALREADY-VALIDATED address, and to that address only (ADR-035).
 *
 * `assertPublicUrl` resolves the host and refuses private/metadata targets, but handing the
 * hostname to `fetch` afterwards lets undici resolve it a SECOND time — and the attacker here is a
 * tenant admin who can both set the webhook URL and control its DNS. `attacker.example` answers with
 * a public address for our check and `169.254.169.254` for the connection a millisecond later; the
 * delivery runs inside the compose network, so a success means our own metadata service or database
 * is POSTed to with a tenant-controlled body. That is the DNS-rebinding gap the guard has always
 * documented and never closed.
 *
 * It is closed by never resolving twice: connect to the IP that was validated, and carry the real
 * hostname in `Host` and in TLS `servername` so SNI and certificate verification are unchanged.
 * Pinning the address does not weaken TLS — the certificate is still checked against the hostname
 * the tenant configured; it only removes the attacker's ability to change which machine answers.
 *
 * No new dependency (ADR-035 rejected pulling in `undici` for a dispatcher): node:http(s) does this
 * natively, and the outbound path is exactly where an extra dependency is least welcome.
 */
export interface DeliverResult {
  status: number
  ok: boolean
}

export interface DeliverOptions {
  /** the URL as the tenant configured it — its hostname is what TLS verifies against */
  url: URL
  /** the address `assertPublicUrl` validated; the socket goes HERE and nowhere else */
  ip: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

export async function deliverWebhook(opts: DeliverOptions): Promise<DeliverResult> {
  const isHttps = opts.url.protocol === 'https:'
  const port = opts.url.port !== '' ? Number(opts.url.port) : isHttps ? 443 : 80
  const path = `${opts.url.pathname}${opts.url.search}`

  // headers are normalised to lower case so a caller passing `Host` cannot produce a SECOND Host
  // header alongside ours — node sends both, and which one an endpoint honours is its own business
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v
  // the ORIGINAL hostname: virtual hosts, and any endpoint that routes on Host, must see the name
  // the tenant configured rather than the bare IP we dialled
  headers['host'] = opts.url.host
  headers['content-length'] = String(Buffer.byteLength(opts.body))

  // WHATWG URL keeps the brackets on an IPv6 literal; every check below wants the bare address.
  const bareHostname = opts.url.hostname.replace(/^\[|\]$/g, '')

  const options: RequestOptions = {
    host: opts.ip,
    port,
    path,
    method: 'POST',
    headers,
    timeout: opts.timeoutMs,
    // TLS: verify the certificate against the HOSTNAME even though we dialled an address. Without
    // `servername` the handshake would send no SNI and then fail identity checks against an IP.
    // Omitted for an IP-literal webhook URL: RFC 6066 forbids an IP as SNI and node warns (DEP0123);
    // identity is still checked, as `IP: … is not in the cert's list`.
    // `hostname` is UNBRACKETED first: WHATWG URL keeps the brackets on an IPv6 literal
    // (`https://[2001:db8::1]/` → hostname `[2001:db8::1]`), which `isIP` does not recognise — so
    // the carve-out was missed and we sent a bracketed SNI that no handshake can complete.
    ...(isHttps ? { rejectUnauthorized: true, ...(isIP(bareHostname) ? {} : { servername: bareHostname }) } : {}),
  }

  return await new Promise<DeliverResult>((resolve, reject) => {
    let settled = false
    const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
      const status = res.statusCode ?? 0
      // A redirect is the same escalation by another route — following it would resolve a NEW host
      // and undo everything above. A webhook endpoint has no business 302-ing, so this is refused
      // rather than followed, exactly as the old `redirect: 'error'` did.
      if (status >= 300 && status < 400) {
        res.resume()
        done(new Error(`status ${status} (redirect refused)`))
        return
      }
      // drain: an unread response body keeps the socket alive to the timeout and leaks agents
      res.resume()
      // The RESPONSE emits the error when a peer sends headers and then destroys the socket, and
      // `req.on('error')` never fires for it. Without this listener the promise simply never settles
      // — and the webhook worker runs at concurrency 1, so ONE endpoint that RSTs mid-body (a
      // draining load balancer is enough; malice is optional) stops webhook delivery for EVERY
      // tenant, indefinitely. Measured: still pending at 30 s against a 1 s timeout.
      res.on('error', done)
      res.on('aborted', () => done(new Error('response aborted')))
      res.on('end', () => done(null, { status, ok: status >= 200 && status < 300 }))
    })

    // A DEADLINE, not `timeout`. `timeout` is socket INACTIVITY: any byte resets it, so an endpoint
    // dribbling one byte every 100 ms is never cut off, and one dribbling its headers took 10× the
    // budget (measured). The whole point of the option is that a hostile or sick endpoint cannot pin
    // a worker slot, which inactivity alone does not deliver.
    const deadline = setTimeout(() => {
      req.destroy(new Error(`timeout after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)
    // …and keep the socket-inactivity timer too: it kills a connect that never completes sooner than
    // the deadline would, and costs nothing.
    req.on('timeout', () => req.destroy(new Error(`timeout after ${opts.timeoutMs}ms`)))
    req.on('error', done)
    req.end(opts.body)

    function done(err: Error | null, result?: DeliverResult): void {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (err !== null) reject(err)
      else resolve(result!)
    }
  })
}
