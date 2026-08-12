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
      {/* A REAL request and a REAL response. This card used to show an invented API — an
          `Authorization: Bearer` key (the API takes `X-Api-Key`), a `?tenant=` parameter (scope comes
          from the credential), a `{data, meta}` envelope and snake_case fields that no endpoint
          returns. The first code a prospect reads has to be the API they actually get. Shape:
          `GET /v1/devices/last` → `{ devices: LiveEvent[] }` (packages/shared liveEventSchema). */}
      <pre className="p-5 leading-relaxed text-ink/85 overflow-x-auto text-[13px] mono">
{`$ curl -H "X-Api-Key: $ORBETRA_KEY" \\
    https://dash.orbetra.com/v1/devices/last

{
  "devices": [
    {
      "deviceId": "1042",
      "accountId": "<account-id>",
      "fixTimeMs": 1754303735000,
      "lat": 54.6872,
      "lon": 25.2797,
      "speed": 48,
      "course": 137,
      "satellites": 11,
      "fixValid": true,
      "ignition": true,
      "priority": 0
    }
  ]
}`}
      </pre>
    </div>
  );
}
