-- This column represents the U.S. state originally selected by the volunteer.
-- It is different than the channel name in that:
-- 1) It doesn't indicate pod number, or demo/non-demo
-- 2) It is especially important if the channel is a region (e.g. Eastern North)
-- and the user's U.S. state would be otherwise unknown to the database.
ALTER TABLE messages
ADD COLUMN state_name text;