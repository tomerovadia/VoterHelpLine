--- Table to explicit track thread state

CREATE TABLE threads (
    slack_parent_message_ts text,
    channel_id text,
    user_id text,
	user_phone_number text,
    needs_attention bool,
    updated_at timestamp without time zone,
    history_ts text,
    PRIMARY KEY (slack_parent_message_ts)
);
CREATE INDEX ON threads (channel_id);
CREATE INDEX ON threads (user_id);
CREATE INDEX ON threads (needs_attention);
CREATE INDEX ON threads (updated_at);


INSERT INTO threads
WITH foo AS (
    SELECT
        m.slack_parent_message_ts
        , slack_channel as channel_id
        , m.user_id
        , CASE WHEN direction='INBOUND' THEN from_phone_number ELSE to_phone_number END as user_phone_number
        , COALESCE(slack_send_timestamp, slack_receive_timestamp) as updated_at
        , direction
        , automated
        , archived
        , row_number() OVER (PARTITION BY m.slack_parent_message_ts ORDER BY COALESCE(slack_send_timestamp, slack_receive_timestamp) DESC) as rn
        , c.volunteer_slack_user_id
    FROM messages m
    LEFT JOIN volunteer_voter_claims c ON (
        m.slack_parent_message_ts=c.slack_parent_message_ts
    )
    WHERE m.slack_parent_message_ts IS NOT NULL AND slack_channel IS NOT NULL
)
SELECT
    slack_parent_message_ts
    , channel_id
    , user_id
    , user_phone_number
    , CASE WHEN direction='INBOUND' OR volunteer_slack_user_id IS NULL THEN true ELSE false END as needs_attention
    , updated_at
    , NULL
FROM foo
WHERE rn = 1
;
