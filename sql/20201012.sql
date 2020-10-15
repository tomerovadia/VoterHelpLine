--- Table to explicit track thread state

CREATE TABLE threads (
    slack_parent_message_ts text,
    slack_channel_id text,
    user_id text,
    user_phone_number text,
    needs_attention bool,
    updated_at timestamp without time zone,
    history_ts text,
    PRIMARY KEY (slack_parent_message_ts)
);
CREATE INDEX ON threads (slack_channel_id);
CREATE INDEX ON threads (user_id);
CREATE INDEX ON threads (needs_attention);
CREATE INDEX ON threads (updated_at);



INSERT INTO threads

--- first, identify the most recent mapping of user_id to a (thread, channel)
WITH all_threads AS (
    SELECT
        slack_parent_message_ts
        , slack_channel
        , user_id
        , is_demo
        , CASE WHEN row_number() OVER (PARTITION BY user_id, is_demo ORDER BY slack_send_timestamp DESC) = 1 THEN 1 ELSE 0 END as best
    FROM messages
)
, newest_threads AS (
    SELECT * FROM all_threads WHERE best = 1
)

--- then pull out the newest message
, all_messages AS (
    SELECT
        m.slack_parent_message_ts
        , m.slack_channel as slack_channel_id
        , m.user_id
        , CASE WHEN direction='INBOUND' THEN from_phone_number ELSE to_phone_number END as user_phone_number
        , COALESCE(slack_send_timestamp, slack_receive_timestamp) as updated_at
        , direction
        , automated
        , archived
        , row_number() OVER (PARTITION BY m.slack_parent_message_ts ORDER BY COALESCE(slack_send_timestamp, slack_receive_timestamp) DESC) as rn
        , c.volunteer_slack_user_id
        , EXISTS (
            SELECT FROM newest_threads n WHERE
                n.user_id = m.user_id
                AND n.is_demo = m.is_demo
                AND n.slack_channel = m.slack_channel
                AND n.slack_parent_message_ts = m.slack_parent_message_ts
                AND n.best = 1
        ) as is_newest_thread
    FROM messages m
    LEFT JOIN volunteer_voter_claims c ON (
        m.slack_parent_message_ts = c.slack_parent_message_ts
    )
    WHERE m.slack_parent_message_ts IS NOT NULL AND m.slack_channel IS NOT NULL
)
SELECT
    slack_parent_message_ts
    , slack_channel_id
    , user_id
    , user_phone_number
    --- needs_attention if this the user's newest thread AND (they texted last OR no volunteer)
    , CASE WHEN is_newest_thread AND (direction='INBOUND' OR volunteer_slack_user_id IS NULL) THEN true
            ELSE false END AS needs_attention
    , updated_at
    , NULL as history_ts
FROM all_messages
WHERE
    rn = 1
;
