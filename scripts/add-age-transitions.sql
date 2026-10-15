-- Birthdates for children, the 18th-birthday role prompt, and parent-consented
-- account invites for an existing (accountless) child profile.
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS turning18_notice_sent_at TIMESTAMPTZ;
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_last_sent_at TIMESTAMPTZ;
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_count INTEGER DEFAULT 0;
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS adult_prompt_snoozed_until TIMESTAMPTZ;
ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS child_member_id TEXT;
ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_by TEXT;
ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
