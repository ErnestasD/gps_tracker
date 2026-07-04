/** Seeded LCG — deterministic scenario streams (E02-1 AC: reproducible with --seed). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
