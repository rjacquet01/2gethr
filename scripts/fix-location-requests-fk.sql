-- Admin legal live pings store requester_user_id = 'legal:<caseId>', which
-- is not a users row, so the foreign key added by
-- scripts/create-location-requests-table.sql rejected them:
--   violates foreign key constraint "location_requests_requester_user_id_fkey"
-- Drops only that constraint. The foreign keys on target_user_id and
-- family_id stay. No column types change and no rows are touched.
-- Safe to run more than once. lib/location-schema.ts does the same lazily.
ALTER TABLE location_requests DROP CONSTRAINT IF EXISTS location_requests_requester_user_id_fkey;
