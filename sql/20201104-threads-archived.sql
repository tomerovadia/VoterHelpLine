ALTER TABLE threads
ADD COLUMN archived boolean;

UPDATE threads t
SET archived = true
WHERE
    is_demo
    AND EXISTS (
        SELECT null FROM messages m
        WHERE
            t.slack_channel_id = m.slack_channel
            AND t.slack_parent_message_ts = m.slack_parent_message_ts
            AND t.user_id = m.user_id
            AND m.is_demo
            AND m.archived
    )
;
