CREATE TYPE message_direction AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE entry_point AS ENUM ('PULL', 'PUSH');
CREATE TYPE voter_status AS ENUM ('UNKNOWN', 'UNREGISTERED', 'REGISTERED', 'REQUESTED_BALLOT', 'RECEIVED_BALLOT', 'IN_PERSON', 'VOTED', 'REFUSED', 'SPAM');

CREATE TABLE messages (
    message text,
    entry_point entry_point,
    direction message_direction,
    is_demo boolean,
    automated boolean,
    successfully_sent boolean,
    from_phone_number varchar(12),
    to_phone_number varchar(12),
    user_id varchar(45),
    originating_slack_user_id varchar(15),
    originating_slack_user_name varchar(40),
    slack_channel varchar(30),
    slack_parent_message_ts double precision,
    twilio_send_timestamp timestamp,
    twilio_receive_timestamp timestamp,
    slack_send_timestamp timestamp,
    slack_receive_timestamp timestamp,
    twilio_message_sid varchar(35),
    slack_message_ts double precision,
    slack_error text,
    twilio_error text,
    last_voter_message_secs_from_epoch bigint,
    confirmed_disclaimer boolean,
    unprocessed_message text,
    slack_retry_num integer,
    slack_retry_reason varchar(30)
);

CREATE TABLE voter_status_updates (
	created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	user_id varchar(45),
	user_phone_number varchar(15),
	twilio_phone_number varchar(12),
	is_demo boolean,
	voter_status voter_status,
	originating_slack_user_name varchar(40),
	originating_slack_user_id varchar(15),
	originating_slack_channel_name varchar(40),
	originating_slack_channel_id varchar(20),
	originating_slack_parent_message_ts DOUBLE PRECISION,
	action_ts DOUBLE PRECISION
);

CREATE TABLE volunteer_voter_claims (
	created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	user_id varchar(45),
	user_phone_number varchar(15),
	twilio_phone_number varchar(12),
    is_demo boolean,
	volunteer_slack_user_name varchar(40),
	volunteer_slack_user_id varchar(40),
	originating_slack_user_name varchar(40),
	originating_slack_user_id varchar(15),
	originating_slack_channel_name varchar(40),
	originating_slack_channel_id varchar(20),
	originating_slack_parent_message_ts DOUBLE PRECISION,
	action_ts DOUBLE PRECISION
);
