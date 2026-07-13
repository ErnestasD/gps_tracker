import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { cpus } from 'node:os'
import { join } from 'node:path'

import { Redis } from 'ioredis'
import { GenericContainer, Wait } from 'testcontainers'

import { parseAckLatencyBuckets, p99FromBuckets, quantileFromBuckets, readMetric } from './histogram.js'

/**
 * W7-S3 load-test gate (§5): 1,500 msg/s for 10 min, p99 ACK < 250 ms, zero loss
 * (reconnect-storm model). ISOLATED — its own Redis (testcontainers) + a freshly spawned
 * ingest process, so it never touches the live staging box.
 *
 * Architecture matters: ingest runs as a SEPARATE process (not in-process), and the client
 * load is spread across N simulator processes. A single Node event loop hosting both the
 * server and hundreds of pacing clients saturates one core and the sleeps drift into hours —
 * so we fan out. p99 ACK is read from the ingest's own `ack_latency_ms` histogram via
 * /metrics (the histogram helper is unit-tested).
 *
 * Env: LOAD_DEVICES (550), LOAD_HZ (3), LOAD_DURATION_S (600), LOAD_RAMP_MS (8),
 * LOAD_PROCS (default cores-2). Exits non-zero on any gate miss.
 */
const DEVICES = Number(process.env['LOAD_DEVICES'] ?? 550)
const HZ = Number(process.env['LOAD_HZ'] ?? 3)
const DURATION_S = Number(process.env['LOAD_DURATION_S'] ?? 600)
const RAMP_MS = Number(process.env['LOAD_RAMP_MS'] ?? 8)
const PROCS = Math.max(1, Number(process.env['LOAD_PROCS'] ?? Math.max(1, cpus().length - 2)))
const BASE_IMEI = 860000000000000n
const TARGET_MSG_S = 1500
const P99_BUDGET_MS = 250
const INGEST_PORT = 5299
const PROM_PORT = 9299

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitTcp(host: string, port: number, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    const ok = await new Promise<boolean>((res) => {
      const s = connect(port, host).on('connect', () => { s.destroy(); res(true) }).on('error', () => res(false))
    })
    if (ok) return
    if (Date.now() - t0 > timeoutMs) throw new Error(`ingest ${host}:${port} not up in ${timeoutMs}ms`)
    await sleep(200)
  }
}

interface SimResult { devices: number; failed: number; sentPackets: number; ackedRecords: number; underAckedPackets: number; rejected: number }

async function main(): Promise<void> {
  console.log(`W7-S3 load test: ${DEVICES} devices × ${HZ} hz ≈ ${DEVICES * HZ} msg/s, ${DURATION_S}s, ${PROCS} generator procs`)
  // LOAD_REDIS_URL: use an EXTERNAL redis (skip testcontainers). This is how the definitive
  // run happens on a native-Linux box — Docker Desktop's Linux VM on a Mac throttles the
  // client generators' timers, so a Mac sustained run is not a valid throughput number.
  const externalRedis = process.env['LOAD_REDIS_URL']
  const redisC = externalRedis ? null : await new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start()
  const redisUrl = externalRedis ?? `redis://${redisC!.getHost()}:${redisC!.getMappedPort(6379)}`
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })

  const pipe = redis.pipeline()
  for (let i = 0; i < DEVICES; i++) pipe.hset('registry:imei', (BASE_IMEI + BigInt(i)).toString(), String(i + 1))
  await pipe.exec()

  const ingest = spawn(TSX, ['apps/ingest/src/main.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, REDIS_URL: redisUrl, INGEST_TCP_PORT: String(INGEST_PORT), PROMETHEUS_PORT: String(PROM_PORT), INGEST_MAX_CONN_PER_IP: String(DEVICES + 100) },
    stdio: ['ignore', 'ignore', 'ignore'], // its SIGTERM-shutdown redis noise is harmless post-report
  })
  await waitTcp('127.0.0.1', INGEST_PORT)

  const count = Math.max(1, Math.round(HZ * DURATION_S))
  const per = Math.ceil(DEVICES / PROCS)
  const t0 = Date.now()
  const sims: ChildProcess[] = []
  const outputs: string[] = Array.from({ length: PROCS }, () => '')
  const done = Array.from({ length: PROCS }, (_, j) => new Promise<void>((resolve) => {
    const nDev = Math.min(per, DEVICES - j * per)
    if (nDev <= 0) return resolve()
    const imei = (BASE_IMEI + BigInt(j * per)).toString()
    const p = spawn(TSX, ['tools/simulator/src/main.ts',
      '--scenario', 'liveDrive', '--devices', String(nDev), '--imei', imei,
      '--hz', String(HZ), '--count', String(count), '--ramp-ms', String(RAMP_MS),
      '--port', String(INGEST_PORT), '--host', '127.0.0.1', '--seed', String(1 + j * 1000)],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
    p.stdout?.on('data', (d: Buffer) => { outputs[j] += d.toString() })
    p.on('exit', () => resolve())
    sims.push(p)
  }))
  await Promise.all(done)
  const elapsedS = (Date.now() - t0) / 1000
  void sims

  const agg = outputs.reduce<SimResult>((acc, out) => {
    const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'))
    if (line === undefined) return acc
    const r = JSON.parse(line) as SimResult
    return { devices: acc.devices + r.devices, failed: acc.failed + r.failed, sentPackets: acc.sentPackets + r.sentPackets, ackedRecords: acc.ackedRecords + r.ackedRecords, underAckedPackets: acc.underAckedPackets + r.underAckedPackets, rejected: acc.rejected + r.rejected }
  }, { devices: 0, failed: 0, sentPackets: 0, ackedRecords: 0, underAckedPackets: 0, rejected: 0 })

  const metrics = await (await fetch(`http://127.0.0.1:${PROM_PORT}/metrics`)).text()
  const p99 = p99FromBuckets(parseAckLatencyBuckets(metrics))
  const p50 = quantileFromBuckets(parseAckLatencyBuckets(metrics), 0.5)
  const ingMsgs = readMetric(metrics, 'ingest_msgs_total') ?? 0
  const ingAcked = readMetric(metrics, 'ingest_acked_records_total') ?? 0

  const throughput = agg.ackedRecords / elapsedS
  const loss = agg.sentPackets - agg.ackedRecords
  const zeroLoss = loss === 0 && agg.underAckedPackets === 0 && agg.failed === 0 && agg.rejected === 0 && ingMsgs === ingAcked
  const pass = throughput >= TARGET_MSG_S && !p99.saturated && p99.value < P99_BUDGET_MS && zeroLoss

  console.log('\n================ W7-S3 LOAD TEST REPORT ================')
  console.log(`generator procs      : ${PROCS} × ~${per} devices`)
  console.log(`devices              : ${agg.devices} (failed: ${agg.failed}, rejected: ${agg.rejected})`)
  console.log(`config               : ${HZ} hz/device, ${count} pkts/device, ramp ${RAMP_MS}ms`)
  console.log(`duration             : ${elapsedS.toFixed(1)}s`)
  console.log(`packets sent / acked : ${agg.sentPackets} / ${agg.ackedRecords}`)
  console.log(`ingest msgs / acked  : ${ingMsgs} / ${ingAcked}`)
  console.log(`throughput           : ${throughput.toFixed(0)} msg/s   (target >= ${TARGET_MSG_S})`)
  console.log(`ACK latency p50 / p99: ${p50.value.toFixed(0)}ms / ${p99.value.toFixed(0)}ms${p99.saturated ? '+' : ''}   (budget p99 < ${P99_BUDGET_MS}ms)`)
  console.log(`loss                 : ${loss} records, ${agg.underAckedPackets} under-acked  ->  ${zeroLoss ? 'ZERO LOSS' : 'LOSS DETECTED'}`)
  console.log(`GATE                 : ${pass ? 'PASS' : 'FAIL'}`)
  console.log('=======================================================\n')

  ingest.kill('SIGTERM')
  await redis.quit()
  await redisC?.stop()
  process.exit(pass ? 0 : 1)
}

main().catch((err: unknown) => { console.error(err); process.exit(1) })
