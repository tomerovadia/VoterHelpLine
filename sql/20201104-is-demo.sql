--- add is_demo to threads
ALTER TABLE threads
ADD COLUMN is_demo boolean;


WITH demo_channel AS (
    SELECT DISTINCT(slack_channel) FROM messages WHERE is_demo=true
)
UPDATE threads
SET is_demo = true
WHERE EXISTS (
    SELECT 1 FROM demo_channel d WHERE threads.slack_channel_id = d.slack_channel
);

WITH demo_channel AS (
    SELECT DISTINCT(slack_channel) FROM messages WHERE is_demo=true
)
UPDATE threads
SET is_demo = false
WHERE NOT EXISTS (
    SELECT 1 FROM demo_channel d WHERE threads.slack_channel_id = d.slack_channel
);
