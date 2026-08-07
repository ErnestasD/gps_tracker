-- Per-account language and units for everything the SERVER renders (closes the five `TODO(account-settings)` markers).
--
-- The web has had a full display-preferences panel since E03-2 — language, km/mi, km/h/mph, l/gal —
-- and it was device-local: localStorage, never sent anywhere. So a Lithuanian haulier could set the
-- dashboard to Lithuanian and miles, and every alert e-mail, Telegram message and scheduled report
-- still arrived in English and kilometres. The product looked localized and its outbound mail was
-- not, which is worse than never offering the choice.
--
-- WHY THE ACCOUNT AND NOT THE USER. The recipients have no user row to read a preference from: a
-- rule's notification channel targets a free-text address (a dispatcher, a shared inbox, an on-call
-- alias) and a scheduled report carries a `recipients[]` array of the same. The account is the
-- fleet — one operation, one country, one set of units — which is exactly why `timezone` has been an
-- account column since the beginning (hard rule 7).
--
-- Defaults are the current behaviour (English, metric), so every existing row keeps rendering
-- exactly as it does today and nothing changes for a customer who never opens Settings.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "locale"       TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "unitSpeed"    TEXT NOT NULL DEFAULT 'kmh';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "unitDistance" TEXT NOT NULL DEFAULT 'km';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "unitVolume"   TEXT NOT NULL DEFAULT 'l';

-- No CHECK constraint on purpose. The API validates against the shared zod enums, and the renderers
-- fall back to metric/English on any value they do not recognise — a constraint here would instead
-- turn "a later release adds Latvian" into a failed migration on a live table, and turn a bad write
-- into a 500 on the settings page rather than a rejected field. The floor that matters (never crash
-- an e-mail renderer over a preference) is enforced where the rendering happens.
