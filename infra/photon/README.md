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
