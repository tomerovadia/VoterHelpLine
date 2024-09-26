-- couple more indexes for message

CREATE INDEX idx_messages_slack_parent_message_ts
ON messages(slack_parent_message_ts);

CREATE INDEX idx_messages_twilio_message_sid
ON messages(twilio_message_sid);

-- add fields to messages to store Twilio callback data

ALTER TABLE messages
ADD COLUMN twilio_callback_status text;


ALTER TABLE messages
ADD COLUMN twilio_callback_timestamp timestamptz;

-- store slack message timestamps as text, not numbers (they're not really numbers)
-- See: https://github.com/slackhq/slack-api-docs/issues/7#issuecomment-67913241
--
-- When converting, we need to be careful to format the existing timestamps
-- with 6 decimal places. This is because in the past we were storing a ts
-- provided by slack as a number, so "1234.567000" was being stored as 1234.567.
-- In order to now convert it back to the original timestamp, we need to use
-- 6 decimal places to that it ends up as "1234.567000" and not "1234.567".
ALTER TABLE messages
ALTER COLUMN slack_parent_message_ts TYPE text USING trim(to_char(slack_parent_message_ts, '99999999999999999999999999.999999'));

ALTER TABLE messages
ALTER COLUMN slack_message_ts TYPE text USING trim(to_char(slack_message_ts, '99999999999999999999999999.999999'));

ALTER TABLE voter_status_updates
ALTER COLUMN slack_parent_message_ts TYPE text USING trim(to_char(slack_parent_message_ts, '99999999999999999999999999.999999'));

ALTER TABLE voter_status_updates
ALTER COLUMN action_ts TYPE text USING trim(to_char(action_ts, '99999999999999999999999999.999999'));

ALTER TABLE volunteer_voter_claims
ALTER COLUMN slack_parent_message_ts TYPE text USING trim(to_char(slack_parent_message_ts, '99999999999999999999999999.999999'));

ALTER TABLE volunteer_voter_claims
ALTER COLUMN action_ts TYPE text USING trim(to_char(action_ts, '99999999999999999999999999.999999'));

