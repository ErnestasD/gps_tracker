# CAN compatibility datasets

`extract.py` converts Teltonika's official supported-vehicles XLSX lists into the static
JSON the marketing site's `/compatibility` page reads (`apps/site/public/can/*.json`).

Source files go into `data/` (not committed — ~2.4 MB of binaries, and Teltonika updates
them periodically):

| data/ file        | Source |
|-------------------|--------|
| `fmx150.xlsx`     | https://wiki.teltonika-gps.com/view/FMX150_supported_vehicles (officially covers FMB/FMC/FMM150 + FMC250/FMM250) |
| `lvcan200.xlsx`   | https://wiki.teltonika-gps.com/view/LV-CAN200 → "(4P) List" xlsx |
| `allcan300.xlsx`  | https://wiki.teltonika-gps.com/view/ALL-CAN300 → "(4P) List" xlsx |
| `cancontrol.xlsx` | https://wiki.teltonika-gps.com/view/CAN-CONTROL → "List" xlsx |

Adapter-compatible trackers (per the LV-CAN200 wiki page): FMB110/120/122/125/130,
FMC125/130, FMM125/130, FMU125/126/130, FMX640 series; FMB140 has the adapter built in.
Not covered by these lists: OBD-plug trackers (FMX00Y) read generic OBD-II PIDs, and the
FMX250/FMX640 truck side (FMS/tachograph) is a separate J1939/FMS standard, not per-vehicle
programs.

Refresh flow: download the new lists into `data/`, bump the `updated` dates in
`extract.py`, run `python3 tools/can-compat/extract.py`, commit the regenerated JSON.
