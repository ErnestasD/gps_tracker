import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { AdminButton, AdminLabel, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/commands")({
  component: CommandsPage,
});

/** Demo mirror of the real Codec-12 command CONSOLE (CommandsCard): preset chips, a fixed-dark
 * terminal transcript (prompt lines + indented device replies), and the prompt input itself
 * (Enter sends, ↑ recalls). Destructive commands keep the two-step arm/confirm. */
const CONSOLE = {
  bg: "#0B1020",
  line: "#22304C",
  ink: "#E6EDF3",
  muted: "#8B949E",
  prompt: "#7AA2F7",
  reply: "#7CE38B",
  danger: "#F97066",
} as const;

type CmdStatus = "queued" | "sent" | "acked" | "failed" | "expired";

const STATUS_GLYPH: Record<CmdStatus, { glyph: string; color: string }> = {
  queued: { glyph: "·", color: CONSOLE.muted },
  sent: { glyph: "→", color: CONSOLE.prompt },
  acked: { glyph: "✓", color: CONSOLE.reply },
  failed: { glyph: "✗", color: CONSOLE.danger },
  expired: { glyph: "✗", color: CONSOLE.danger },
};

const STATUS_LABEL: Record<CmdStatus, string> = {
  queued: "Eilėje",
  sent: "Išsiųsta",
  acked: "Patvirtinta",
  failed: "Nepavyko",
  expired: "Pasibaigusi",
};

// Presets as in the real product (COMMAND_PRESETS + devices.cmd.preset.* in lt.json)
const PRESETS = [
  { key: "getinfo", label: "Informacija", text: "getinfo" },
  { key: "getver", label: "Versija", text: "getver" },
  { key: "getgps", label: "GPS padėtis", text: "getgps" },
  { key: "getio", label: "IO būsena", text: "getio" },
  { key: "cpureset", label: "Perkrauti", text: "cpureset" },
  { key: "dout_on", label: "Išvestis įjungta", text: "setdigout 1" },
  { key: "dout_off", label: "Išvestis išjungta", text: "setdigout 0" },
  { key: "reporting_interval", label: "Siuntimo intervalas", text: "setparam 10050:30" },
  { key: "server_address", label: "Serverio adresas", text: "setparam 2004:0.0.0.0,2005:5027" },
  { key: "deleterecords", label: "Trinti įrašus", text: "deleterecords" },
];

const isDestructive = (cmd: string) => /^(cpureset|deleterecords)\b/.test(cmd.trim());

const DEVICES = [
  { id: "dev_0001", name: "Sprinter 01", plate: "KLM 482", imei: "867000121000001" },
  { id: "dev_0002", name: "Transit 02", plate: "JRT 105", imei: "867000121000002" },
  { id: "dev_0003", name: "Van 03", plate: "FKD 731", imei: "867000121000003" },
  { id: "dev_0004", name: "Truck 04", plate: "BNS 264", imei: "867000121000004" },
];

interface Entry {
  id: string;
  text: string;
  status: CmdStatus;
  response: string | null;
  at: string;
}

// Canned device replies so the demo console answers like a real FMC130
function replyFor(cmd: string, imei: string): string {
  if (cmd.startsWith("getinfo"))
    return `INI:2026/8/30 4:01 RTC:2026/9/1 6:44 RST:1 ERR:0 SR:0 BR:0 CF:0 FG:0 FL:0 UT:0 SMS:0 NOGPS:0:0 GPS:1 SAT:13 RS:3 RF:38 MD:0 REC:41`;
  if (cmd.startsWith("getver"))
    return `Ver:03.29.02.Rev.00 GPS:AXN_5.10 Hw:FMC130 IMEI:${imei} Init:2026-08-30`;
  if (cmd.startsWith("getgps"))
    return "GPS:1 Sat:13 Lat:54.687157 Long:25.279652 Alt:112 Speed:0 Dir:143 Date:2026/9/1 Time:06:44:12";
  if (cmd.startsWith("getio"))
    return "DI1:0 DI2:0 DO1:0 DO2:0 AIN1:0.02V Battery:4.02V Ext:12.61V";
  if (cmd.startsWith("setdigout"))
    return "DOUT1:1 DOUT2:0 Timeout:INFINITY";
  if (cmd.startsWith("setparam"))
    return "New value(s) set successfully";
  if (cmd.startsWith("cpureset"))
    return "CPU reset will be executed";
  if (cmd.startsWith("deleterecords"))
    return "All records deleted";
  return `Invalid command: ${cmd}`;
}

// Seed only the first device with a short session; the rest greet with the "console ready" line.
const SEED: Record<string, Entry[]> = {
  dev_0001: [
    {
      id: "c1",
      text: "getver",
      status: "acked",
      response: replyFor("getver", "867000121000001"),
      at: "2026-09-01 06:41",
    },
    {
      id: "c2",
      text: "getgps",
      status: "acked",
      response: replyFor("getgps", "867000121000001"),
      at: "2026-09-01 06:44",
    },
  ],
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CommandsPage() {
  const [deviceId, setDeviceId] = React.useState<string>(DEVICES[0]?.id ?? "");
  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];
  const [histories, setHistories] = React.useState<Record<string, Entry[]>>(SEED);
  const [text, setText] = React.useState("");
  const [armed, setArmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const history = histories[device.id] ?? [];

  // pending reply timers — cleared on unmount so a navigated-away demo doesn't set state
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  React.useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // ↑/↓ recall previous commands (unique, newest first); -1 means "own draft"
  const recall = [...new Set(history.map((c) => c.text).reverse())];
  const [recallIdx, setRecallIdx] = React.useState(-1);
  const onPromptKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(recallIdx + 1, recall.length - 1);
      const cmd = recall[next];
      if (next >= 0 && cmd !== undefined) { setCommand(cmd); setRecallIdx(next); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = recallIdx - 1;
      const cmd = recall[next];
      if (next < 0) { setCommand(""); setRecallIdx(-1); }
      else if (cmd !== undefined) { setCommand(cmd); setRecallIdx(next); }
    }
  };

  // keep the console pinned to the newest line as the transcript grows
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastResponded = history.filter((c) => c.response !== null).length;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [history.length, lastResponded, device.id]);

  const setCommand = (next: string) => {
    setText(next);
    setArmed(false); // any edit or preset switch disarms a pending destructive confirm
    setError(null);
  };

  const switchDevice = (id: string) => {
    setDeviceId(id);
    setCommand("");
    setRecallIdx(-1);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = text.trim();
    if (cmd === "") return;
    if (!/^[\x20-\x7e]+$/.test(cmd)) {
      setError("Komandoje leidžiami tik spausdinami ASCII simboliai.");
      return;
    }
    if (isDestructive(cmd) && !armed) {
      setArmed(true); // first click only arms — the operator must confirm
      return;
    }
    const targetId = device.id;
    const id = `c${Date.now()}`;
    setHistories((h) => ({ ...h, [targetId]: [...(h[targetId] ?? []), { id, text: cmd, status: "sent", response: null, at: nowStamp() }] }));
    setText("");
    setArmed(false);
    setError(null);
    setRecallIdx(-1);
    // the "device" answers after a moment — flips → to ✓ and prints the reply
    timers.current.push(
      setTimeout(() => {
        setHistories((h) => ({
          ...h,
          [targetId]: (h[targetId] ?? []).map((c) =>
            c.id === id ? { ...c, status: "acked", response: replyFor(cmd, device.imei) } : c,
          ),
        }));
      }, 1400),
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader
        title="Komandos"
        description="Siųskite Codec 12 komandas įrenginiui ir stebėkite atsakymus konsolėje."
        className="mb-0"
      />

      {/* demo-only device picker above the console (in the product the console lives in the map inspector) */}
      <div className="max-w-xs">
        <AdminLabel>Įrenginys</AdminLabel>
        <Combobox
          value={deviceId}
          onChange={switchDevice}
          options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))}
        />
      </div>

      {/* console card — mirrors the real CommandsCard */}
      <div className="admin-card p-4 md:p-5">
        <h2 className="mb-4 font-semibold" style={{ color: "var(--admin-ink)" }}>Komandos — {device.name}</h2>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <AdminButton
                key={p.key}
                size="sm"
                variant={isDestructive(p.text) ? "ghost" : "secondary"}
                style={isDestructive(p.text) ? { background: "transparent", color: "var(--admin-danger)" } : undefined}
                onClick={() => setCommand(p.text)}
              >
                {p.label}
              </AdminButton>
            ))}
          </div>

          {armed && (
            <p role="alert" className="text-sm" style={{ color: "var(--admin-danger)" }}>
              Ši komanda yra destruktyvi ir negrįžtama. Spustelėkite dar kartą, kad išsiųstumėte į įrenginį.
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-sm" style={{ color: "var(--admin-danger)" }}>{error}</p>
          )}

          {/* the console: history as a session transcript + the prompt as the input */}
          <div
            className="overflow-hidden rounded-lg border font-mono text-xs"
            style={{ background: CONSOLE.bg, borderColor: CONSOLE.line }}
          >
            <div ref={scrollRef} className="max-h-80 space-y-2 overflow-y-auto p-3">
              {history.length === 0 ? (
                <p style={{ color: CONSOLE.muted }}>
                  {device.name} konsolė paruošta. Pasirinkite komandą viršuje arba įveskite savo — Enter išsiunčia, ↑ pakartoja ankstesnę.
                </p>
              ) : (
                history.map((c) => {
                  const st = STATUS_GLYPH[c.status];
                  const pending = c.status === "queued" || c.status === "sent";
                  return (
                    <div key={c.id}>
                      <div className="flex items-baseline gap-2">
                        <span aria-hidden style={{ color: CONSOLE.prompt }}>›</span>
                        <span className="break-all" style={{ color: CONSOLE.ink }}>{c.text}</span>
                        <span title={STATUS_LABEL[c.status]} style={{ color: st.color }}>{st.glyph}</span>
                        <span className="ml-auto shrink-0" style={{ color: CONSOLE.muted }}>{c.at}</span>
                      </div>
                      {c.response !== null && c.response !== "" ? (
                        <pre className="whitespace-pre-wrap break-all pl-5" style={{ color: CONSOLE.reply }}>{c.response}</pre>
                      ) : pending ? (
                        <div className="animate-pulse pl-5" style={{ color: CONSOLE.muted }}>laukiama įrenginio atsakymo…</div>
                      ) : (
                        <div className="pl-5" style={{ color: CONSOLE.danger }}>{STATUS_LABEL[c.status]}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <form
              onSubmit={submit}
              className="flex items-center gap-2 border-t px-3 py-2"
              style={{ borderColor: CONSOLE.line }}
            >
              <span aria-hidden style={{ color: armed ? CONSOLE.danger : CONSOLE.prompt }}>›</span>
              <input
                value={text}
                onChange={(e) => { setCommand(e.target.value); setRecallIdx(-1); }}
                onKeyDown={onPromptKey}
                maxLength={512}
                placeholder="Komandos tekstas (pvz., getinfo)"
                aria-label="Siųsti"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
                style={{ color: CONSOLE.ink, caretColor: CONSOLE.prompt }}
              />
              <AdminButton
                type="submit"
                size="sm"
                variant={armed ? "danger" : "primary"}
                disabled={text.trim() === ""}
              >
                {armed ? `Patvirtinti: ${text.trim()}` : "Siųsti"}
              </AdminButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
