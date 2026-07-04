# Hetzner staging setup (E00-2, human runbook)

Production hardware (AX42 dedicated, ~€52/mo) is decided AFTER the E07-3 load test
(ADR-006). What we need NOW is only the **staging** box.

## What to order — Hetzner Cloud CPX31 (~€14/mo)

1. https://console.hetzner.cloud → create project **orbetra**.
2. **Add Server**:
   - Location: **Falkenstein (fsn1)** — EU data residency pillar.
   - Image: **Ubuntu 24.04 LTS**.
   - Type: **Shared vCPU x86 → CPX31** (4 vCPU AMD, 8 GB RAM, 160 GB NVMe).
   - Networking: leave public IPv4 + IPv6 on.
   - SSH key: ADD YOUR KEY (never password auth).
   - Name: `orbetra-staging`.
3. After creation, hand the IP to Claude — Ansible (infra/ansible) does the rest:
   UFW (22/80/443/5027), Docker, compose stack, chrony.

Storage Box (backups, ~€4/mo) is only needed from E07-2 — order later.
Photon geocoder needs disk: 160 GB NVMe is enough for PL(+LT) extracts.

## DNS (when the domain exists)
Point `staging.<domain>` A/AAAA at the server IP; Caddy handles TLS automatically.
