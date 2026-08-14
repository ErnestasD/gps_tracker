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

Open the device → **Onboarding**. The sheet gives the exact SMS for that model. It is, for a
staging test:

```
  setparam 2004:185.80.129.33;2005:5027;2006:0
```

The **two leading spaces are part of the message** — they are the empty SMS login and password that
Teltonika's syntax requires. Without them the device ignores the command.

If the SIM needs an APN, send that first:

```
  setparam 2001:<apn>
```

`2006:0` selects **TCP**, which is what we want: TCP 5027 is open to the internet on the staging
box, **UDP 5027 is not** (the firewall allows only tcp). A device left on UDP will look completely
dead — no connection, no log, nothing in quarantine.

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
4. **`fix_valid` vs `satellites == 0`.** Rule 6 says these must be the same set; a mismatch is ours.

## What we already know about these two

**FTC887** — 190 elements, no parser warnings. Ignition 239, movement 240, odometer resolves to 16.
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
