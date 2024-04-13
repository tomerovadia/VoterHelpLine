-- Add index to state_name column of messages table.
-- This column will be frequently used for searching/filtering.
CREATE INDEX ON messages (state_name);
