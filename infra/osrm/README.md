# OSRM (self-hosted route optimization backend, ADR-029)

- Image: `ghcr.io/project-osrm/osrm-backend:v5.27.1` (BSD-2 — rule 13 compliant, like Photon).
- Serves the `/trip` service the API's `POST /v1/routing/optimize` proxies to
  (http://project-osrm.org/docs/v5.24.0/api/#trip-service).
- Pilot coverage is **Lithuania only** (Geofabrik extract). Stops outside LT snap to
  nothing and the API answers 422 "unroutable".
- The compose service is behind `profiles: [osrm]` — local `make up` SKIPS it (devs
  don't have the prepared volume; the API 503-degrades). Staging/prod opt in with
  `--profile osrm` (or `COMPOSE_PROFILES=osrm`) after preparing the volume below.

## One-time volume prep (repeat quarterly for fresh OSM data)

Preprocessing peaks at ~4–6 GB RAM (LT) — run off-peak on KVM-3 (15 GB) or prep on
another machine and copy the volume. Serving needs only ~1–2 GB RSS; the prepared
volume is ~2–3 GB on disk.

```sh
# 1) download the extract into the named volume (≈400 MB)
docker volume create orbetra_osrm_data
docker run --rm -v orbetra_osrm_data:/data alpine \
  wget -O /data/lithuania-latest.osm.pbf \
  https://download.geofabrik.de/europe/lithuania-latest.osm.pbf

# 2) preprocess for MLD (extract → partition → customize), car profile
OSRM=ghcr.io/project-osrm/osrm-backend:v5.27.1
docker run --rm -v orbetra_osrm_data:/data $OSRM osrm-extract -p /opt/car.lua /data/lithuania-latest.osm.pbf
docker run --rm -v orbetra_osrm_data:/data $OSRM osrm-partition /data/lithuania-latest.osrm
docker run --rm -v orbetra_osrm_data:/data $OSRM osrm-customize /data/lithuania-latest.osrm

# 3) start the service and point the API at it
COMPOSE_PROFILES=osrm docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d osrm
# in /opt/orbetra/.env:  OSRM_URL=http://osrm:5000   … then `up -d api`
```

NOTE: the compose volume name is `orbetra_osrm_data` because the base file pins
`name: orbetra` (compose prefixes volume names with the project name).

## Growing coverage (V2: +PL etc.)

The container serves ONE dataset. To cover several countries, merge extracts before
step 2 with osmium (available in the `stefda/osmium-tool` image or via apt):

```sh
osmium merge lithuania-latest.osm.pbf poland-latest.osm.pbf -o lt-pl.osm.pbf
```

Then extract/partition/customize `lt-pl.osm.pbf` the same way (RAM/disk scale with the
extract — re-check KVM-3 headroom first). Time windows / capacities = VROOM in front of
OSRM (documented V2 path, ADR-029).

## Verification (staging-only)

Real-route verification happens on staging — there is no local OSRM. After prep:

```sh
curl 'http://127.0.0.1:5001/nearest/v1/driving/25.2797,54.6872'         # code: Ok
curl 'http://127.0.0.1:5001/trip/v1/driving/25.28,54.69;25.32,54.70?roundtrip=true&source=first'
```

(Port 5001 is loopback-published on the host — reach it via SSH tunnel, PR #11 rule.)

## Refresh cadence

Quarterly: re-run the prep block (steps 1–2) off-peak, then `docker compose restart osrm`.
