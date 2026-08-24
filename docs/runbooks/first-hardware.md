# First real tracker — what to do, in order

Everything this platform knows about AVL elements comes from Teltonika's wiki pages, and the
simulator that exercises the pipeline is built from those same pages. So no test we own can catch
the wiki being wrong or the firmware differing from it. A device can, and this is the run that does
it.

Two devices are going on real vehicles: **FTC887** and **FMC150**.

---

## 1. Create the device BEFORE powering it on

Ingest refuses an IMEI it has never seen — that is the design (`registry:imei`), not a bug. A
tracker powered on first lands in quarantine and you have to claim it out.

Devices → **Add device** → pick the exact model in the picker → paste the IMEI printed on the
device → save. The picker now lists all 105 models; type `887` or `150` to find yours.

> If you do power it on first, it is not lost: Devices → Quarantine → Claim. Check the model in
> the claim dialog — it defaults to FMB120, which is **not** your device.

## 2. Point the tracker at the server

Open the device → **Onboarding**, or just press **Send config SMS** and let the platform send it.

The **leading whitespace is part of the message** — it stands in for the unset SMS password — and
**how much of it depends on the platform**. Copy the sheet's string exactly rather than retyping it.

| platform | models | syntax | prefix |
|---|---|---|---|
| FMB generation | FMB/FMC/FMM/FMU/FMP/FMT/FM, TAT, GH, TST, TMT, MSP, MTB, TFT (80 of 105) | `<login> <password> <command>` | **two** spaces |
| FT "Fast & Easy" | FTC\*, FTM\*, ATC\*, ATM\* (25 of 105) | `<password> <command>` | **one** space |

So for **FMC150**:

```
  setparam 2004:185.80.129.33;2005:5027;2006:0
```

and for **FTC887** — one space, not two:

```
 setparam 2004:185.80.129.33;2005:5027;2006:0
```

Sources: [FMB120](https://wiki.teltonika-gps.com/view/FMB120_SMS/GPRS_Commands) ("leave two spaces
before command") and [FTC887](https://wiki.teltonika-gps.com/view/FTC887_SMS/GPRS_Command_List)
("enter the password OR a whitespace"). Note even the page NAMES differ — `_Commands` vs
`_Command_List` — which is a quick way to tell which family a new model belongs to.

Get this wrong and there is no error anywhere: the SMS is delivered, the device parses nothing,
answers nothing, and never connects. At the server that looks exactly like a dead SIM. It cost a
live FTC887 session on 2026-08-18 before the platform sent the right prefix.

If the SIM needs an APN, the sheet includes it (2001) in the same message. Sent alone it is:

```
  setparam 2001:<apn>      ← FMB;  one space for FT
```

**Sending it by hand from an iPhone is unreliable** — iOS strips leading whitespace when it
data-detects an IP or URL in the message, which silently removes the prefix. Compose in Notes and
paste, or better, use the platform's Send button (Twilio preserves the exact bytes).

`2006:0` selects **TCP**, which is what we want: TCP 5027 is open to the internet on the staging
box, **UDP 5027 is not** (the firewall allows only tcp). A device left on UDP will look completely
dead — no connection, no log, nothing in quarantine.

## 2b. FTC/FTM ship with their position hidden — onboarding clears it

Worth knowing, because the symptom is a perfect impostor. Parameter **11813 "GPS data masking"**
defaults to `1` — *"GNSS data sent as zero"* — inside a Private mode these models cannot leave:
switching needs a DIN input FTC887 does not physically have, and the weekly Business window is
factory-set to 00:00–00:00.

So a brand-new FTC/FTM transmits zeros for position, satellite count **and the GNSS date**, forever.
On the server that is indistinguishable from a tracker that cannot see the sky:

```
GNSS Status: 2        (module ON, searching)
satellites:  0
HDOP/PDOP:   1000     (the no-fix sentinel)
getgps:      GPS:0 Sat:0 LAT:0 LON:0 Date:1970-01-01
```

It cost most of 2026-08-18 — eight hours on a windowsill with those numbers, then **16 satellites
and a valid fix in the same minute** that `11813` went to 0. The receiver had been tracking the
whole time.

The config SMS now carries `;11813:0` for FTC/FTM (founder decision 2026-08-18: a masked position
contradicts the purpose of the platform). **ATC/ATM and the FMB generation do not have this
parameter and must never be sent it** — naming an id a model does not implement risks the device
rejecting the whole `setparam`.

If you ever meet the signature above on a device onboarded some other way, send `setparam 11813:0`
before suspecting the antenna.

## 3. Watch it arrive

```sh
ssh -i ~/.ssh/orbetra_staging root@185.80.129.33
docker logs -f orbetra-ingest-1
```

Expect, in order: the IMEI handshake accepted (`0x01`), then an ACK per frame carrying the record
count. An IMEI answered `0x00` was not created (step 1) or was typed wrong.

## 4. Run the first-contact check

This is the point of the whole exercise. It diffs what the device ACTUALLY sent against what its own
dictionary promises.

```sh
cd /opt/orbetra/app/infra/compose
docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
  run --rm api tsx tools/hw-check/src/main.ts <IMEI>
```

Read the output in this order:

1. **`io_<id>` parameters.** Each one is a bare number a customer would see instead of a name.
2. **"ids arrived that this model's wiki page does NOT document".** If this is non-empty, Teltonika's
   page is incomplete for that model — worth reporting to them, and worth a dictionary note.
3. **ignition / movement / odometer.** If ignition never arrives, trips will not open on a vehicle
   profile. FTC887 and FMC150 both document all three.
4. **`fix_valid` vs `satellites == 0`.** Rule 6 says these must be the same set — **except for an
   exact 0/0, which is invalid at ANY satellite count** (ADR-039; the FTC887 below is the reason).
   Any OTHER mismatch is ours.

## What we already know about these two

**FTC887** — an **FT-platform, battery-mounted** tracker (Teltonika's "Fast & Easy" category), so:
one-space SMS prefix per the table above, and note its own wiki warns that **SMS and GPRS commands
are not received in Deep Sleep or Power Off Sleep** — the modem is off, so the device is not
reachable at all. If a config SMS seems ignored, confirm it is awake before suspecting the command.

190 elements, no parser warnings. Ignition 239, movement 240, odometer resolves to 16.
It has **no id 66**: its external voltage is id **800**, also in mV, so the health chart scales
correctly. It carries no iButton, no alarm input and no DIN1 — expect those columns empty, and that
is the hardware, not us. Its id 252 is spelled `Unplug detection`; the power-cut rule reads that
spelling, which it did not before this month.

**FMC150** — 422 elements, everything in the usual places: 239, 240, odometer 16, external voltage
66 (×0.001), battery 67, iButton 78, `Unplug`, `Alarm`, DIN1. On this table id 216 is
`Geofence zone 35`, **not** an odometer — which is exactly why the odometer is resolved per model
rather than hardcoded.

## If something looks wrong

Capture before changing anything: `docker logs orbetra-ingest-1 > /tmp/ingest.log`, and note the
IMEI and the wall-clock minute. The raw frames for anything we could not decode are parked in the
`raw:unsupported` Redis stream, and sanity-rejected records in `rejects` — both are bounded samples,
so pull them the same day.
