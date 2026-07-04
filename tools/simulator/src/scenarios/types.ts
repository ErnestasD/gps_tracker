export interface ScenarioOpts {
  imei: string
  seed: number
  hz: number
  /** Number of AVL records to emit in total. */
  count: number
  /** Fixed base timestamp (ms) for deterministic runs; CLI defaults to Date.now(). */
  startMs: number
}

export interface Scenario {
  name: string
  /** Wire-ready AVL packets (the runner owns handshake + ACK reading). */
  packets(opts: ScenarioOpts): Iterable<Buffer> | AsyncIterable<Buffer>
}
