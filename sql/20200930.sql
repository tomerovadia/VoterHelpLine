-- Convert varchar types to text

-- messages

ALTER TABLE messages
ALTER COLUMN from_phone_number TYPE text;

ALTER TABLE messages
ALTER COLUMN to_phone_number TYPE text;

ALTER TABLE messages
ALTER COLUMN user_id TYPE text;

ALTER TABLE messages
ALTER COLUMN originating_slack_user_id TYPE text;

ALTER TABLE messages
ALTER COLUMN originating_slack_user_name TYPE text;

ALTER TABLE messages
ALTER COLUMN slack_channel TYPE text;

ALTER TABLE messages
ALTER COLUMN twilio_message_sid TYPE text;

ALTER TABLE messages
ALTER COLUMN slack_retry_reason TYPE text;


-- voter_status_updates

ALTER TABLE voter_status_updates
ALTER COLUMN user_id TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN user_phone_number TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN twilio_phone_number TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN originating_slack_user_name TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN originating_slack_user_id TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN originating_slack_channel_name TYPE text;

ALTER TABLE voter_status_updates
ALTER COLUMN originating_slack_channel_id TYPE text;


-- volunteer_voter_claims

ALTER TABLE volunteer_voter_claims
ALTER COLUMN user_id TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN user_phone_number TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN twilio_phone_number TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN volunteer_slack_user_name TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN volunteer_slack_user_id TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN originating_slack_user_name TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN originating_slack_user_id TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN originating_slack_channel_name TYPE text;

ALTER TABLE volunteer_voter_claims
ALTER COLUMN originating_slack_channel_id TYPE text;