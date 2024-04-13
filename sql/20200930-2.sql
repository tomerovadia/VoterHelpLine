-- Remove "originating" from some column names.
-- These columns identify the voter's Slack channel and thread,
-- which in the case of a voter status button press, is necessarily
-- the same as the originating Slack channel and thread.
-- Now that the change of a voter status can be automated, these
-- columns are useful to help identify the voter, even if the "origin"
-- of the update isn't the channel/thread themselves.
-- Leaving " originating" for originating_slack_user_name and
-- originating_slack_user_id.

ALTER TABLE voter_status_updates
RENAME COLUMN originating_slack_channel_name TO slack_channel_name;

ALTER TABLE voter_status_updates
RENAME COLUMN originating_slack_channel_id TO slack_channel_id;

ALTER TABLE voter_status_updates
RENAME COLUMN originating_slack_parent_message_ts TO slack_parent_message_ts;

ALTER TABLE volunteer_voter_claims
RENAME COLUMN originating_slack_channel_name TO slack_channel_name;

ALTER TABLE volunteer_voter_claims
RENAME COLUMN originating_slack_channel_id TO slack_channel_id;

ALTER TABLE volunteer_voter_claims
RENAME COLUMN originating_slack_parent_message_ts TO slack_parent_message_ts;