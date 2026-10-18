-- Lets a parent assign a saved place to specific kids. A place with no rows
-- here applies to everyone (the behavior every existing place keeps); a place
-- with rows only triggers arrival/departure for the assigned members.
CREATE TABLE IF NOT EXISTS saved_place_members (
  place_id TEXT NOT NULL REFERENCES saved_places(id) ON DELETE CASCADE,
  family_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (place_id, family_member_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_place_members_member ON saved_place_members(family_member_id);
