export interface ScenarioOpts {
  imei: string
  seed: number
  hz: number
  /** Number of AVL records to emit in total. */
  count: number
  /** Fixed base timestamp (ms) for deterministic runs; CLI defaults to Date.now(). */
  startMs: number
  /** Optional per-byte write delay (slow-loris style trickling). */
  byteDelayMs?: number
  /** Route start offset in metres (fleet mode spreads devices; liveDrive only). */
  startDistanceM?: number
}

export interface Scenario {
  name: string
  /** Wire-ready AVL packets (the runner owns handshake + ACK reading). */
  packets(opts: ScenarioOpts): Iterable<Buffer> | AsyncIterable<Buffer>
}
