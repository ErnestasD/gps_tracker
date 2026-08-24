# Photon (self-hosted reverse/forward geocoding)

- Image: `rtuszik/photon-docker` (PROJECT_PLAN §2) with GraphHopper prebuilt country
  extracts — no Nominatim import needed.
- First boot downloads the index for `COUNTRY_CODE` (PL ≈ several GB) into the
  `photon_data` volume; the compose healthcheck allows a 15 min warmup. Subsequent
  boots are fast.
- Countries at launch: PL (+LT when multi-country support of the wrapper is wired;
  the upstream image takes ONE country code — for PL+LT+DE we run one instance per
  country behind the geocode-cache service, or switch to a manual multi-country dump.
  Decision deferred to E04-4 which consumes the cache; tracked there.)
- komoot's public instance is dev-only fair-use — NEVER production (CLAUDE.md rule 13).
- Endpoints: `GET /reverse?lat=..&lon=..`, `GET /api?q=..` (forward), `GET /status`.

## Status: behind the `photon` profile, NOT started by default

`docker compose up -d` does **not** start Photon. Enable it with `COMPOSE_PROFILES=photon`
only after the index is prepared and an api consumer for `GEOCODER_URL` exists.

It used to start on every deploy, and failed on every deploy: the image tried to build an
index needing **152 GB** of temp space on a 97 GB disk, logged `Insufficient disk space` and
exited. `photon_data` was still 4 KB — the index had never downloaded once. Nothing alerted,
because nothing reads `GEOCODER_URL` yet.

The image is pinned by **digest**. `COUNTRY_CODE: pl` asks for the Poland extract (a few GB);
a planet-sized download is not what this config requests, so the behaviour changed underneath
us on an unpinned `:latest`. Re-pin deliberately when upgrading, and verify `photon_data`
actually fills before calling it provisioned.
