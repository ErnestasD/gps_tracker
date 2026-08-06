import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'

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

  const options: RequestOptions = {
    host: opts.ip,
    port,
    path,
    method: 'POST',
    headers: {
      ...opts.headers,
      // the ORIGINAL hostname: virtual hosts, and any endpoint that routes on Host, must still see
      // the name the tenant configured rather than a bare IP
      host: opts.url.host,
      'content-length': String(Buffer.byteLength(opts.body)),
    },
    timeout: opts.timeoutMs,
    // TLS: verify the certificate against the HOSTNAME even though we dialled an address. Without
    // `servername` the handshake would send no SNI and then fail identity checks against an IP.
    ...(isHttps ? { servername: opts.url.hostname, rejectUnauthorized: true } : {}),
  }

  return await new Promise<DeliverResult>((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
      const status = res.statusCode ?? 0
      // A redirect is the same escalation by another route — following it would resolve a NEW host
      // and undo everything above. A webhook endpoint has no business 302-ing, so this is refused
      // rather than followed, exactly as the old `redirect: 'error'` did.
      if (status >= 300 && status < 400) {
        res.resume()
        reject(new Error(`status ${status} (redirect refused)`))
        return
      }
      // drain: an unread response body keeps the socket alive to the timeout and leaks agents
      res.resume()
      res.on('end', () => resolve({ status, ok: status >= 200 && status < 300 }))
    })
    req.on('timeout', () => {
      // `timeout` does not abort by itself — without this a hung endpoint holds the socket forever
      req.destroy(new Error(`timeout after ${opts.timeoutMs}ms`))
    })
    req.on('error', reject)
    req.end(opts.body)
  })
}
