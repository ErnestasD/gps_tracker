# CAN compatibility datasets

`extract.py` converts Teltonika's official supported-vehicles XLSX lists into the static
JSON the marketing site's `/compatibility` page reads (`apps/site/public/can/*.json`).

Source files go into `data/` (not committed — ~2.4 MB of binaries, and Teltonika updates
them periodically):

| data/ file      | Source |
|-----------------|--------|
| `fmx150.xlsx`   | FMX150 Supported Vehicles list (wiki.teltonika-gps.com → FMX150) |
| `lvcan200.xlsx` | https://wiki.teltonika-gps.com/view/LV-CAN200 → "(4P) List" xlsx |
| `allcan300.xlsx`| https://wiki.teltonika-gps.com/view/ALL-CAN300 → "(4P) List" xlsx |

Refresh flow: download the new lists into `data/`, bump the `updated` dates in
`extract.py`, run `python3 tools/can-compat/extract.py`, commit the regenerated JSON.
