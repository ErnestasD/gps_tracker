import { connect } from 'node:net'

import type { Redis } from 'ioredis'

import { encodeAvlPacket, type EncodableRecord } from '@orbetra/codec'

import { pointAt, prepRoute, type PreparedRoute } from './route.js'

/**
 * Virtual-device runner (founder ask: create a mock device, run it Vilnius→Kaunas at a chosen
 * speed, watch it like a real one, restart at will).
 *
 * The whole point of the design: the virtual device enters through the FRONT DOOR — a real
 * Codec-8 TCP session against ingest (hello IMEI → 0x01 → packet → 4-byte ACK, spec §3.2) —
 * so every downstream system (parser, live map, trips, geofences, rules, notifications,
 * reports) treats it EXACTLY like hardware, because to them it is hardware. No side channel,
 * no special-casing in the pipeline.
 *
 * State lives in Redis (`vsim:{deviceId}` hash + `vsim:active` set), written by the API's
 * /v1/devices/:id/vsim endpoints and read here every tick. Worker restarts resume mid-route.
 */

const TICK_MS = 5_000
/** A hidden tab / paused worker must not teleport the vehicle: elapsed is capped per tick. */
const MAX_STEP_S = 30

interface VsimState {
  imei: string
  coords: string // JSON [ [lon,lat], ... ] (OSRM geometry)
  speedKmh: string
  loop: '1' | '0'
  status: 'running' | 'stopped' | 'finished'
  distanceM: string
  lastMs: string
}

export interface VsimRunner {
  stop(): void
}

export function startVsimRunner(opts: { redis: Redis; host: string; port: number; onError?: (err: unknown) => void }): VsimRunner {
  const { redis, host, port } = opts
  const routes = new Map<string, PreparedRoute>() // deviceId → prepared route (rebuilt on coords change)
  const routeKeys = new Map<string, string>()
  let ticking = false

  const tick = async (): Promise<void> => {
    if (ticking) return // a slow ingest round-trip must not stack ticks
    ticking = true
    try {
      const ids = await redis.smembers('vsim:active')
      for (const id of ids) {
        try {
          await advance(id)
        } catch (err) {
          opts.onError?.(err)
          console.error(`vsim advance ${id}`, err)
        }
      }
    } finally {
      ticking = false
    }
  }

  const advance = async (deviceId: string): Promise<void> => {
    const st = (await redis.hgetall(`vsim:${deviceId}`)) as Partial<VsimState>
    if (st.status !== 'running' || st.imei === undefined || st.coords === undefined) {
      if (st.status !== 'running') await redis.srem('vsim:active', deviceId)
      return
    }
    // prepare (and cache) the route; an updated route (restart with new endpoints) re-preps
    if (routeKeys.get(deviceId) !== st.coords) {
      const coords = JSON.parse(st.coords) as [number, number][]
      const prep = prepRoute(coords)
      if (prep === null) {
        await redis.srem('vsim:active', deviceId)
        return
      }
      routes.set(deviceId, prep)
      routeKeys.set(deviceId, st.coords)
    }
    const route = routes.get(deviceId)!
    const now = Date.now()
    const lastMs = Number(st.lastMs ?? now)
    const elapsedS = Math.min(MAX_STEP_S, Math.max(0, (now - lastMs) / 1_000))
    const speedKmh = Math.max(1, Number(st.speedKmh ?? 60))
    let dist = Number(st.distanceM ?? 0) + (speedKmh / 3.6) * elapsedS

    let finished = false
    if (dist >= route.totalM) {
      if (st.loop === '1') dist = dist % route.totalM
      else {
        dist = route.totalM
        finished = true
      }
    }
    const p = pointAt(route, dist)
    // IO ids per the FMB120 AVL table (same set the simulator's drive.ts cites):
    // https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
    const io = new Map<number, bigint | Buffer>([
      [239, finished ? 0n : 1n], // Ignition
      [240, finished ? 0n : 1n], // Movement
      [21, 5n], // GSM Signal
      [66, 12_800n], // External Voltage (mV)
      [89, BigInt(Math.max(5, 90 - Math.floor(dist / 1_000)))], // Fuel level %
    ])
    const rec: EncodableRecord = {
      tsMs: now,
      priority: 0,
      lat: p.lat,
      lon: p.lon,
      altitude: 100,
      angle: p.course,
      satellites: 9,
      speed: finished ? 0 : Math.round(speedKmh),
      eventIoId: 0,
      io,
    }
    await sendPacket(host, port, st.imei, [rec])
    await redis.hset(`vsim:${deviceId}`, {
      distanceM: String(dist),
      lastMs: String(now),
      ...(finished ? { status: 'finished' } : {}),
    })
    if (finished) await redis.srem('vsim:active', deviceId)
  }

  const iv = setInterval(() => void tick(), TICK_MS)
  return {
    stop: () => clearInterval(iv),
  }
}

/**
 * One Codec-8 session (spec §3.2): [2B len][IMEI] → 1 B accept → packet → 4 B BE ack.
 * A fresh connection per tick — wasteful next to a persistent socket, but self-healing by
 * construction (an ingest restart costs one tick, not a stuck runner), and at one packet
 * per device per 5 s the overhead is noise.
 */
function sendPacket(host: string, port: number, imei: string, records: EncodableRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    const fail = (err: Error) => {
      socket.destroy()
      reject(err)
    }
    const timer = setTimeout(() => fail(new Error('vsim send timeout')), 8_000)
    let stage: 'hello' | 'packet' = 'hello'
    socket.once('error', fail)
    socket.on('connect', () => {
      const imeiBuf = Buffer.from(imei, 'ascii')
      const hello = Buffer.alloc(2 + imeiBuf.length)
      hello.writeUInt16BE(imeiBuf.length, 0)
      imeiBuf.copy(hello, 2)
      socket.write(hello)
    })
    socket.on('data', (buf: Buffer) => {
      if (stage === 'hello') {
        if (buf[0] !== 0x01) return fail(new Error('vsim IMEI rejected'))
        stage = 'packet'
        socket.write(encodeAvlPacket(8, records))
        return
      }
      clearTimeout(timer)
      socket.end()
      resolve()
    })
  })
}
