#!/bin/sh
# Render the Alertmanager config from env (no envsubst in the image → sed). BLOCKED-INFO
# (W7-S1): with TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID set, alerts push to the
# founders' Telegram; UNSET → a valid null receiver so Alertmanager still starts and shows
# alerts in its UI + Prometheus /alerts (chat_id:0 is rejected as "missing", so we can't
# just template a placeholder — we swap the whole receiver).
set -e
if [ -n "${TELEGRAM_BOT_TOKEN}" ] && [ -n "${TELEGRAM_ALERT_CHAT_ID}" ]; then
  sed -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN}|g" \
      -e "s|\${TELEGRAM_ALERT_CHAT_ID}|${TELEGRAM_ALERT_CHAT_ID}|g" \
      /etc/alertmanager/alertmanager.yml.tmpl > /tmp/alertmanager.yml
else
  echo "W7-S1: TELEGRAM_BOT_TOKEN/CHAT_ID unset — alerts visible in UI only (no push)" >&2
  cat > /tmp/alertmanager.yml <<'YML'
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
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager
