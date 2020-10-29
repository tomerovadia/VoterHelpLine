ALTER TABLE threads
ADD COLUMN active boolean;


--- populate inactive threads--there may be several of these if the user
--- was routed multiple times.
WITH threads_with_rank AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, is_demo ORDER BY updated_at DESC) AS rn
    FROM threads
)
UPDATE threads
SET active = false
WHERE EXISTS (
    SELECT 1 FROM threads_with_rank r
    WHERE
        r.slack_channel_id = threads.slack_channel_id
        AND r.slack_parent_message_ts = threads.slack_parent_message_ts
        AND r.user_id = threads.user_id
        AND r.is_demo = threads.is_demo
        AND rn > 1
)
;
--- active threads.  there will only be one of these per user.
WITH threads_with_rank AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, is_demo ORDER BY updated_at DESC) AS rn
    FROM threads
)
UPDATE threads
SET active = true
WHERE NOT EXISTS (
    SELECT 1 FROM threads_with_rank r
    WHERE
        r.slack_channel_id = threads.slack_channel_id
        AND r.slack_parent_message_ts = threads.slack_parent_message_ts
        AND r.user_id = threads.user_id
        AND r.is_demo = threads.is_demo
        AND rn > 1
)
;
