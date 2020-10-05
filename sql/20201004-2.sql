CREATE TYPE command_type AS ENUM ('RESET_DEMO');

-- This table should be used to record volunteer and admin commands.
CREATE TABLE commands (
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    command_type command_type,
	user_id text,
	user_phone_number text,
	twilio_phone_number text,
	originating_slack_user_name text,
	originating_slack_user_id text,
	slack_channel_name text,
	slack_channel_id text,
	slack_parent_message_ts DOUBLE PRECISION,
	action_ts DOUBLE PRECISION,
    success boolean
);

-- This field is used to express that a message should not be considered part
-- of a voter's message history when they are routed between channels.
ALTER TABLE messages
ADD COLUMN archived boolean;