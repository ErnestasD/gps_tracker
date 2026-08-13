# First-contact check for a REAL tracker

Run this the moment a physical device connects. It answers the one question no amount of
review can: **does the hardware send what the wiki says it sends?**

Everything we have is derived from Teltonika's wiki pages plus a simulator built from the same
pages. If a page is wrong, or the firmware differs, nothing in the test suite can tell — only a
device can. This script diffs what actually arrived against what the device's own dictionary
promises, and names the gaps in both directions.

## Use

```sh
ssh -i ~/.ssh/orbetra_staging root@185.80.129.33
cd /opt/orbetra/app/infra/compose
docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
  run --rm api tsx tools/hw-check/src/main.ts <IMEI>
```

## What it reports

- **codec** the device negotiated, and the record counts we ACKed
- every AVL id that ARRIVED, with the name our dictionary gave it, and whether it landed under a
  name or fell back to `io_<id>` — the latter is where a customer sees a raw number
- ids the wiki marks `HW Support` for this model that have **not** arrived (expected: many; a
  parameter is only sent when configured and when the hardware carries it)
- ids that arrived and are **absent from the dictionary entirely** — this is the interesting
  column: it means the wiki page is incomplete for this model
- the promoted columns: `ignition`, `movement`, `odometer_m`, and whether `fix_valid` behaved
- a plain-language verdict on the three that decide whether trips work at all
