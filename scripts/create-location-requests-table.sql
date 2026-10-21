-- Create location_requests table for on-demand location pings
CREATE TABLE IF NOT EXISTS location_requests (
  id TEXT PRIMARY KEY,
  -- No foreign key: legal requests use 'legal:<caseId>' (see fix-location-requests-fk.sql).
  requester_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'EXPIRED', 'DECLINED')),
  fulfilled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_location_requests_target_user ON location_requests(target_user_id);
CREATE INDEX IF NOT EXISTS idx_location_requests_status ON location_requests(status);
CREATE INDEX IF NOT EXISTS idx_location_requests_expires ON location_requests(expires_at);

-- Add comment for documentation
COMMENT ON TABLE location_requests IS 'Stores on-demand location requests from parents to family members';
