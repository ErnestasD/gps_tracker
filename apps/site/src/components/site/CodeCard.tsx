export function CodeCard() {
  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--hairline)] bg-[var(--blueprint)]">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="mono text-[10px] tracking-widest text-muted-foreground uppercase">curl · GET · v1</span>
      </div>
      <pre className="p-5 leading-relaxed text-ink/85 overflow-x-auto text-[13px] mono">
{`$ curl -H "Authorization: Bearer $ORBETRA_KEY" \\
    https://api.orbetra.eu/v1/devices?tenant=acme

{
  "data": [
    {
      "id": "353173094123456",
      "name": "MB Sprinter — VIN…9F42",
      "position": { "lat": 52.229, "lng": 21.012 },
      "speed_kmh": 48,
      "ignition": true,
      "last_seen": "2025-07-04T10:22:15Z"
    }
  ],
  "meta": { "count": 1 }
}`}
      </pre>
    </div>
  );
}
