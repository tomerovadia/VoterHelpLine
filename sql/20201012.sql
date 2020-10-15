--- Table to explicit track thread state

CREATE TABLE threads (
    slack_parent_message_ts text,
    slack_channel_id text,
    user_id text,
    user_phone_number text,
    needs_attention bool,
    updated_at timestamp without time zone,
    history_ts text,
    PRIMARY KEY (slack_parent_message_ts, slack_channel_id)
);
CREATE INDEX ON threads (user_id);
CREATE INDEX ON threads (needs_attention);
CREATE INDEX ON threads (updated_at);


--- One caveat here: if a voter is routed but no additional messages have been sent, there is no
--- state in messages that we can use to determine the new thread's id, so we mark the lobby thread
--- as the one thta needs attention (because it is the newest thread for the voter).

INSERT INTO threads

---- We need to identify the *latest* claim
with claims AS (
    SELECT
        user_id
        , slack_parent_message_ts
        , slack_channel_id
        , volunteer_slack_user_id
        , volunteer_slack_user_name
        , row_number () OVER (PARTITION BY slack_parent_message_ts, slack_channel_id ORDER BY created_at DESC) AS rn
    FROM volunteer_voter_claims
)

--- and latest status
, statuses AS (
    SELECT
        *
        , row_number () OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
    FROM voter_status_updates
)

--- first, identify the most recent mapping of user_id to a (thread, channel)
, messages_user_window AS (
    SELECT
        slack_parent_message_ts
        , slack_channel
        , user_id
        , is_demo
        , CASE WHEN row_number() OVER (PARTITION BY user_id, is_demo ORDER BY slack_send_timestamp DESC) = 1 THEN 1 ELSE 0 END as best
    FROM messages
    WHERE slack_parent_message_ts IS NOT NULL
)
, newest_messages AS (
    SELECT * FROM messages_user_window WHERE best = 1
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
        , row_number() OVER (PARTITION BY m.slack_parent_message_ts, m.slack_channel ORDER BY COALESCE(slack_send_timestamp, slack_receive_timestamp) DESC) as rn
        , c.volunteer_slack_user_id
        , EXISTS (
            SELECT FROM newest_messages n WHERE
                n.user_id = m.user_id
                AND n.is_demo = m.is_demo
                AND n.slack_channel = m.slack_channel
                AND n.slack_parent_message_ts = m.slack_parent_message_ts
        ) as is_newest_thread
        , EXISTS (
            SELECT FROM statuses s WHERE
                s.user_id = m.user_id
                AND s.is_demo = m.is_demo
                AND rn = 1
                AND voter_status IN ('REFUSED', 'SPAM')
        ) as is_refused_spam
    FROM messages m
    LEFT JOIN claims c ON (
        m.slack_parent_message_ts = c.slack_parent_message_ts
        AND c.rn = 1
    )
    WHERE m.slack_parent_message_ts IS NOT NULL AND m.slack_channel IS NOT NULL
)
SELECT
    slack_parent_message_ts
    , slack_channel_id
    , user_id
    , user_phone_number
    --- needs_attention if this the user's newest thread AND (they texted last OR no volunteer)
    , CASE WHEN is_newest_thread AND NOT is_refused_spam AND (direction='INBOUND' OR volunteer_slack_user_id IS NULL) THEN true
            ELSE false END AS needs_attention
    , updated_at
    , NULL as history_ts
FROM all_messages
WHERE
    rn = 1
;
