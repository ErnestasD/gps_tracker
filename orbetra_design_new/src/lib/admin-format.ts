// Deterministic date formatters — SSR and client return identical strings.
// Uses UTC to avoid timezone drift between server and client.
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtNumber(n: number): string {
  // Thin space between groups, no locale ambiguity.
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
}
