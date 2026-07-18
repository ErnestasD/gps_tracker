import { createSocket, type RemoteInfo, type Socket as UdpSocket } from 'node:dgram'
import type { Redis } from 'ioredis'

import { CrcError, decodeUdpHeader, encodeUdpAck, FrameError, parseUdpAvl } from '@orbetra/codec'

import { GlobalRateLimiter, HandshakeRateLimiter } from './limits.js'
import type { IngestMetrics } from './metrics.js'
import { persistAvlBatch } from './persist.js'
import { DeviceRegistry } from './registry.js'
import { getCachedShardDepth, SHARD_COUNT, type SessionConfig } from './session.js'

export interface UdpConfig extends SessionConfig {
  /** Datagrams accepted per source IP per minute (IMEI-spoof flood guard). */
  maxDatagramsPerIpPerMin: number
  /** Global datagrams/sec ceiling — the primary spoof-flood defense (ADR-027). */
  maxDatagramsPerSec: number
  /** Max concurrently in-flight datagram handlers. UDP can't pause the socket, so when Redis
   *  is slow/down the unawaited handlers (and their pinned datagram Buffers + ioredis offline-
   *  queue commands) would grow without bound → OOM (§10 failure #11). Above this we drop the
   *  datagram without ACK (the device resends). Default 10_000. */
  maxInFlightDatagrams?: number
}

export interface IngestUdpServer {
  socket: UdpSocket
  close(): Promise<void>
}

/**
 * Teltonika UDP Channel listener (connectionless §3.2). ZERO business logic (rule 3): decode →
 * verify → registry lookup → sanity → XADD → ACK. Nothing else.
 *
 * UDP differs from the TCP session in three ways: (1) every datagram is self-contained (carries its
 * own IMEI — no handshake, no per-socket state); (2) the registry lookup on EVERY datagram is also
 * the E08-4 retire check (a retired device stops being persisted immediately); (3) there is no flow
 * control — instead of pausing under backpressure we SHED (drop without ACK) so a slow Redis can
 * never grow an unbounded buffer (§10 failure #11); the device resends. Persistence + the ACK count
 * go through the SAME shared helper as TCP (persist.ts) so both transports are byte-identical.
 *
 * The metrics instance is SHARED with the TCP server so msgs/acked/parse-fail/sanity counters
 * aggregate both channels; UDP-only counters live alongside.
 */
export function createIngestUdpServer(
  redis: Redis,
  metrics: IngestMetrics,
  config: UdpConfig,
  observeAckLatencyMs?: (ms: number) => void,
  now: () => number = Date.now,
): IngestUdpServer {
  const registry = new DeviceRegistry(redis)
  const global = new GlobalRateLimiter(config.maxDatagramsPerSec, now)
  const perIp = new HandshakeRateLimiter(config.maxDatagramsPerIpPerMin, now)
  const socket = createSocket('udp4')
  const maxInFlight = config.maxInFlightDatagrams ?? 10_000
  let inFlight = 0
  // bound the per-IP window map against a spoofed-source flood (ADR-027)
  const sweepTimer = setInterval(() => perIp.sweep(), 60_000)
  sweepTimer.unref()

  socket.on('message', (datagram, rinfo) => {
    // Hard in-flight cap FIRST: the handler is unawaited, so without this a slow/down Redis
    // lets pending handlers (each pinning its datagram Buffer + a stalled ioredis command)
    // grow unbounded until OOM — the load-shed depth-check downstream is itself a Redis call
    // and can't fire when Redis is unavailable. Drop without ACK; the device resends (§10 #11).
    if (inFlight >= maxInFlight) {
      metrics.udpInflightDropsTotal++
      return
    }
    inFlight++
    void handle(datagram, rinfo)
      .catch((err: unknown) => {
        // never a silent catch (§9.6): a datagram is fire-and-forget, so surface and move on
        metrics.sessionErrorsTotal++
        console.error('ingest udp error', { err: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        inFlight--
      })
  })
  // an ICMP port-unreachable etc. must not crash the data plane
  socket.on('error', (err) => console.error('ingest udp socket error', err))

  async function handle(datagram: Buffer, rinfo: RemoteInfo): Promise<void> {
    // global ceiling FIRST — source IPs are spoofable, so this (not the per-IP guard) is what bounds
    // total work under a flood; then the per-IP guard shapes a single misbehaving peer (ADR-027).
    if (!global.allow() || !perIp.allow(rinfo.address)) {
      metrics.udpRateLimitedTotal++ // drop before any parse/Redis work, no ACK
      return
    }
    const t0 = now()
    metrics.udpDatagramsTotal++
    metrics.msgsTotal++

    // cheap header decode only — the heavy AVL parse is deferred until the IMEI is authorized, so a
    // spoofed flood with no valid IMEI can't drive the expensive path (ADR-027, review MED)
    let head
    try {
      head = decodeUdpHeader(datagram)
    } catch (err) {
      if (err instanceof FrameError) metrics.frameViolationsTotal++
      else throw err
      return // can't read the header ⇒ can't ACK a packet id; drop, the device resends
    }

    // registry lookup = the retire check too (UDP is stateless — every datagram re-verifies, E08-4)
    const deviceId = await registry.lookup(head.imei)
    if (deviceId === null) {
      metrics.rejectedImeiTotal++
      // countRejects:false — UDP IMEIs are attacker-chosen and the count is unused here, so never
      // create one unbounded-TTL counter key per spoofed IMEI (the zset cap still bounds membership).
      await registry.quarantine(head.imei, now(), { countRejects: false })
      return // unknown/retired device — nothing persisted ⇒ nothing acked (rule 4)
    }

    // authorized: now parse the AVL body
    let parsed
    try {
      parsed = parseUdpAvl(head.avlData)
    } catch (err) {
      if (err instanceof FrameError) metrics.frameViolationsTotal++
      else if (err instanceof CrcError) metrics.parseFailTotal++
      else throw err
      // structurally corrupt body from a KNOWN device — ACK nothing persisted (device resends)
      send(encodeUdpAck(head.packetId, head.avlPacketId, 0), rinfo)
      return
    }

    // command responses over UDP = follow-up; ACK zero-persisted so the device doesn't resend a
    // packet we deliberately ignore (a codec-16 raw-fallback instead parses as an empty avl batch).
    if (parsed.kind !== 'avl') {
      send(encodeUdpAck(head.packetId, head.avlPacketId, 0), rinfo)
      return
    }

    const shard = Number(BigInt(head.imei) % BigInt(SHARD_COUNT)) // rule 5: imei % 16
    // load-shed: UDP can't be paused, so above the shard-depth threshold we drop WITHOUT persisting
    // or ACKing — bounded memory (I4) at the cost of a device resend.
    const depth = await getCachedShardDepth(redis, shard, now(), false, config.depthCacheMs)
    if (depth > config.pauseAboveDepth) {
      metrics.udpBackpressureDropsTotal++
      return
    }

    // persist → THEN ack the count actually XADDed (rule 4 / I1)
    const persisted = await persistAvlBatch(redis, { deviceId, imei: head.imei, shard }, parsed.records, config, metrics, now())
    send(encodeUdpAck(head.packetId, head.avlPacketId, persisted), rinfo)
    observeAckLatencyMs?.(now() - t0)
  }

  function send(reply: Buffer, rinfo: RemoteInfo): void {
    socket.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) console.error('ingest udp ack send failed', err.message) // best-effort; device resends
    })
  }

  return {
    socket,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweepTimer)
        socket.close(() => resolve())
      }),
  }
}
