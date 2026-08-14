#!/bin/sh
# Render the Alertmanager config from env (no envsubst in the image → sed).
#
# THREE receivers, in order of preference. The order is not cosmetic: it is what stops a
# critical alert from being seen by nobody.
#
#   1. Telegram — TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID (founder-provisioned, W7-S1)
#   2. Email    — the SES SMTP credentials the platform ALREADY uses for its own mail,
#                 plus ALERT_EMAIL_TO. No new credential to provision.
#   3. null     — alerts visible in the Alertmanager UI + Prometheus /alerts only.
#
# Why the email tier exists (2026-08-13): the null receiver ran for weeks as a deliberate
# "blocked on Telegram creds" state, and during it `WalArchiveFailing` fired continuously
# for EIGHT DAYS while pg_wal grew to 11 GB — roughly twelve days short of the disk filling
# and PostgreSQL refusing writes. The alert was correct, the rule was correct, and the
# dashboard was green to anyone who did not open it. A working alarm with no live recipient
# is worse than no alarm, because it reads as coverage. Waiting on a Telegram token to route
# alerts, while a perfectly good mail path sat configured, is the mistake this tier removes.
set -e

TMPL=/etc/alertmanager/alertmanager.yml.tmpl
OUT=/tmp/alertmanager.yml

if [ -n "${TELEGRAM_BOT_TOKEN}" ] && [ -n "${TELEGRAM_ALERT_CHAT_ID}" ]; then
  sed -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN}|g" \
      -e "s|\${TELEGRAM_ALERT_CHAT_ID}|${TELEGRAM_ALERT_CHAT_ID}|g" \
      "$TMPL" > "$OUT"
  echo "alertmanager: routing to Telegram" >&2
elif [ -n "${ALERT_EMAIL_TO}" ] && [ -n "${SMTP_HOST}" ] && [ -n "${SMTP_USER}" ] && [ -n "${SMTP_PASS}" ]; then
  # The password goes to a FILE, never through sed into the config: an SES SMTP secret is
  # base64 and may contain `/` or `+`, and `&` is a back-reference in a sed replacement.
  # `auth_password_file` also keeps the secret out of a config anyone may cat while debugging.
  printf '%s' "${SMTP_PASS}" > /tmp/smtp_pass
  chmod 600 /tmp/smtp_pass
  cat > "$OUT" <<YML
global:
  resolve_timeout: 5m
  smtp_smarthost: '${SMTP_HOST}:${SMTP_PORT:-587}'
  smtp_from: '${MAIL_FROM:-alerts@orbetra.com}'
  smtp_auth_username: '${SMTP_USER}'
  smtp_auth_password_file: '/tmp/smtp_pass'
  smtp_require_tls: true

route:
  receiver: email
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    # criticals page immediately and re-notify more often
    - matchers: [ severity="critical" ]
      receiver: email
      group_wait: 0s
      repeat_interval: 1h

receivers:
  - name: email
    email_configs:
      - to: '${ALERT_EMAIL_TO}'
        send_resolved: true
        headers:
          # STATUS FIRST, and the resolved mail says RESOLVED rather than repeating the
          # severity. Sent as-was, "it started" and "it is over" arrived with an identical
          # `[CRITICAL] …` subject — so on a phone at night the two are the same message,
          # and the one that means "go and look" is indistinguishable from the one that
          # means "go back to sleep".
          subject: '{{ if eq .Status "firing" }}[{{ .CommonLabels.severity | toUpper }}]{{ else }}[RESOLVED]{{ end }} {{ .CommonLabels.alertname }} — Orbetra'
        html: |
          <h3>{{ if eq .Status "firing" }}[{{ .CommonLabels.severity | toUpper }}]{{ else }}[RESOLVED]{{ end }} {{ .CommonLabels.alertname }}</h3>
          {{ range .Alerts }}<p><b>{{ .Annotations.summary }}</b><br>
          {{ .Annotations.description }}</p>
          {{ end }}
          <p style="color:#888;font-size:12px">${ALERT_ENV_LABEL:-orbetra} · {{ .Alerts | len }} alert(s)</p>

inhibit_rules:
  - source_matchers: [ severity="critical" ]
    target_matchers: [ severity="warning" ]
    equal: ['component']
YML
  echo "alertmanager: routing to email (${ALERT_EMAIL_TO})" >&2
else
  echo "W7-S1: no Telegram token and no ALERT_EMAIL_TO/SMTP — alerts visible in UI only (no push)" >&2
  cat > "$OUT" <<'YML'
route:
  receiver: 'null'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: 'null'
inhibit_rules:
  - source_matchers: [ severity="critical" ]
    target_matchers: [ severity="warning" ]
    equal: ['component']
YML
fi

exec /bin/alertmanager --config.file="$OUT" --storage.path=/alertmanager
