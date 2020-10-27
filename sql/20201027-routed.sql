ALTER TABLE threads
ADD COLUMN routed boolean;


--- populate routed threads
WITH threads_with_rank AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, is_demo ORDER BY updated_at DESC) AS rn
    FROM threads
)
UPDATE threads
SET routed='t'
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
--- false for active threads
WITH threads_with_rank AS (
    SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC) AS rn
    FROM threads
)
UPDATE threads
SET routed='f'
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