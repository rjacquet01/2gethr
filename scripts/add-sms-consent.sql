-- SMS consent (Twilio 10DLC / TCPA). The app adds these itself on first use
-- (ensureSmsConsentSchema in lib/sms-consent.ts); this is the same change up front.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_text TEXT;
