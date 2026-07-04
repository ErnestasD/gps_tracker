# E01-2 Plan — Infra: compose + Ansible + free-stack services (M)

**Story:** IMPLEMENTATION_PLAN.md E01-2 · **Implements:** PROJECT_PLAN §5 infra, §2 links
**Status:** in progress (lane B worktree, parallel to E01-3 per Appendix D)

## Deliverables
- `infra/compose/docker-compose.yml` — pg (timescale/timescaledb-ha:pg16 = TS+PostGIS),
  redis 7 (appendonly everysec + **noeviction**, §5 BullMQ mandate), photon
  (rtuszik/photon-docker, PL extract, 15 min warmup healthcheck), uptime-kuma,
  prometheus, grafana, loki, caddy.
- `infra/compose/docker-compose.staging.yml` — staging overrides + GlitchTip.
- `infra/Caddyfile` — health endpoint; on-demand TLS ask stub = deny-all until E03-5.
- `infra/smoke.sh` — health + CONTRACT checks (noeviction, appendfsync, TS+PostGIS
  extensions, caddy healthz, Photon reverse-geocode w/ warmup tolerance).
- `infra/ansible/` — site.yml + roles base (deploy user, unattended-upgrades, chrony),
  docker, ufw (22/80/443/5027 allow, default deny), caddy (compose systemd unit).
- `Makefile`: `up` / `smoke` / `down`; `.worktreeinclude` (.env copies into worktrees).

## Deviations / notes
- GlitchTip runs staging-only (compose override) — local dev doesn't need error
  tracking and it drags its own migrations; AC "Grafana/Kuma/GlitchTip behind basic
  auth on staging" is a staging-side check (needs E00-2 Hetzner — still pending).
- Photon upstream image takes ONE country code; PL first, multi-country approach
  decided in E04-4 (documented in infra/photon/README.md).
- promtail deferred until services emit logs worth shipping (E02-5 wires app metrics;
  log shipping joins there) — loki runs so the datasource exists.

## AC status
- `make up` boots stack locally — verified once Docker daemon available
- staging TLS + basic auth — blocked on E00-2 (Hetzner account)
- Photon Vilnius reverse-geocode — in smoke.sh (warmup-tolerant)
- port 5027 reachable — ansible ufw role; verified at staging time
- `CONFIG GET maxmemory-policy` = noeviction asserted — in smoke.sh

## Staging provisioned (2026-07-04)
vpsnet Cloud VPS KVM-3 (4 vCPU / 15 GB / 97 GB, Ubuntu 24.04, KVM), IP 185.80.129.33.
Base (chrony, unattended-upgrades) + Docker 29 + UFW (22/80/443/5027) + core stack up;
smoke passed (redis noeviction/appendfsync, TS+PostGIS, caddy healthz). Photon warming.
**Security finding & fix:** Docker publishes ports via iptables rules that BYPASS UFW —
Grafana/Prometheus/Postgres/Redis were briefly internet-reachable with dev passwords.
Fixed by binding all internal services to 127.0.0.1 (this commit); verified externally
that only Caddy 80/443 + ingest 5027 are public. Access Grafana/etc via SSH tunnel:
`ssh -L 3000:127.0.0.1:3000 root@185.80.129.33`.
Still pending (needs domain/TLS): Caddy reverse-proxy + basic auth for Grafana, GlitchTip.
