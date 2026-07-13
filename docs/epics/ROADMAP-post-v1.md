# Post-V1 autonomous roadmap (V1-nice → V2 → V3)

> Founder mandate 2026-07-13: after W7 ops, autonomously build everything buildable toward
> launch — V1-nice, then V2, then V3. Each item: plan → test-first where it applies →
> smallest diff → gates → fresh adversarial review (0 HIGH) → PR → CI → merge.
> Credential/hardware-blocked items are built to the seam and documented, never faked.

## Ordering principle

Ship the highest **sales-differentiating, unblocked** work first. Skip nothing buildable;
park only what truly needs founder creds (SES/Telegram/R2 already noted) or hardware.

## Tier 1 — V1-nice, unblocked, high leverage (do first)

1. **Device onboarding via SMS** (replaces FOTA cloud — that's gold-tier only). Generate the
   exact per-model server-pointing SMS (`setparam 2004:orbetra.com,2005:5027` + APN) from
   the device's profile; a copy-paste onboarding sheet in the UI. The #1 "connect your
   tracker in 30s" demo moment. → `docs/epics/V1n-sms-onboarding-plan.md`.
2. **Device-health view** (PROJECT_PLAN V1-nice, "#1 TSP support-call deflector"): per-device
   GSM signal, ext/battery voltage trend, last FW string (from getver), last-seen. All fields
   already flow through the pipeline (attrs io_21/io_66/io_67) — this is read + chart.
3. **Temporary share links**: a signed, expiring public URL to a single device's live map /
   a trip — no login. Sales + end-customer value, small surface.
4. **Scheduled + PDF report export**: reuse E06-1 report engine; BullMQ schedule → email
   (gated on SES) / PDF (add a renderer). PDF unblocked; email delivery gated.
5. **Web push** notifications (browser) — complements email/Telegram; unblocked (VAPID keys
   self-generated).
6. **UDP listener** (§4 nice): some Teltonika configs prefer UDP; a second ingest transport.

## Tier 2 — V2, differentiating

7. **Corridor geofences**: route-corridor (buffered polyline) enter/exit — extends E05 geofence
   engine with a line-buffer geometry. High fleet value.
8. **OSM road-speed overspeed**: speed vs the road's posted limit (OSM maxspeed) instead of a
   static threshold — needs an OSM speed lookup (self-hosted, rule 13).
9. **Driver registry (iButton/RFID)** + driver-scoring foundation: AVL driver-id → trips get a
   driver; harsh-accel/brake/corner (AVL 253 green-driving) → score.
10. **Fuel-theft detection**: needs ≥8 weeks of stored LLS data (V2 by design) — build the
    detector (drop/refuel event on the fuel series) now, it activates as data accumulates.
11. **CAN deep decode**: expand the codec dictionaries for CAN AVL IDs (LVCAN/OBD) beyond the
    fuel/basic set — per-family, wiki-cited.
12. **Maintenance module**: odometer/engine-hours-based service reminders.
13. **Custom SMTP/DKIM per tenant**: white-label email sending (V2).
14. **Stripe metered billing**: usage_daily → Stripe metered subscriptions.
15. **EYE sensor pairing** (temperature/humidity BLE beacons).

## Tier 3 — V3+

16. **Tachograph DDD** parsing (heavy, EU compliance).
17. **Video (DualCam)** integration.
18. **Route optimization (OSRM)** self-hosted.
19. **Marketplace integrations**.

## Cross-cutting as we go

- Affiliate module (E09, §6.9): leads table exists (W9-S1) — build attribution + commission
  ledger + monthly statements.
- W8 remaining: legal-pack review, PL i18n native pass (needs a human reviewer — park), UX
  polish from dogfooding.
- Native apps (V2): PWA already installable; a thin wrapper is the cheap path.

## Notes

- Every new AVL ID/protocol claim carries a wiki citation (rule 8).
- No new runtime dep without an ADR (rule 10).
- Credential-gated (SES/Telegram/R2/Stripe/OSM extracts) → build + env-gate + document,
  same pattern as E05-5.
