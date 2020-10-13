--- Table to explicit track thread state

CREATE TABLE threads (
    slack_parent_message_ts text,
    channel_id text,
    user_id text,
	user_phone_number text,
    needs_attention bool,
    updated_at timestamp without time zone,
    PRIMARY KEY (slack_parent_message_ts)
);

INSERT INTO threads
WITH foo AS (
    SELECT
        slack_parent_message_ts
        , slack_channel as channel_id
        , user_id
        , CASE WHEN direction='INBOUND' THEN from_phone_number ELSE to_phone_number END as user_phone_number
        , COALESCE(slack_send_timestamp, slack_receive_timestamp) as updated_at
        , direction
        , automated
        , row_number() OVER (PARTITION BY slack_parent_message_ts ORDER BY COALESCE(slack_send_timestamp, slack_receive_timestamp) DESC) as rn
    FROM messages
    WHERE slack_parent_message_ts IS NOT NULL AND slack_channel IS NOT NULL
)
SELECT
    slack_parent_message_ts
    , channel_id
    , user_id
    , user_phone_number
    , CASE WHEN direction='INBOUND' THEN true ELSE false END as needs_attention
    , updated_at
FROM foo
WHERE rn = 1
;
