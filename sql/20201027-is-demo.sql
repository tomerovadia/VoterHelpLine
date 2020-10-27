--- add is_demo to threads
ALTER TABLE threads
ADD COLUMN is_demo boolean;

WITH demo_number AS (
    SELECT DISTINCT(to_phone_number) as phone
    FROM messages
    WHERE is_demo = true AND direction='INBOUND'
), demo_channel AS (
    SELECT DISTINCT(slack_channel) FROM messages
    WHERE
        EXISTS(SELECT 1 from demo_number WHERE to_phone_number = phone)
        OR EXISTS(SELECT 1 from demo_number WHERE from_phone_number = phone)
)
UPDATE threads
SET is_demo = true
WHERE EXISTS (
    SELECT 1 FROM demo_channel d WHERE threads.slack_channel_id = d.slack_channel
);

WITH demo_number AS (
    SELECT DISTINCT(to_phone_number) as phone
    FROM messages
    WHERE is_demo = true AND direction='INBOUND'
), demo_channel AS (
    SELECT DISTINCT(slack_channel) FROM messages
    WHERE
        EXISTS(SELECT 1 from demo_number WHERE to_phone_number = phone)
        OR EXISTS(SELECT 1 from demo_number WHERE from_phone_number = phone)
)
UPDATE threads
SET is_demo = false
WHERE NOT EXISTS (
    SELECT 1 FROM demo_channel d WHERE threads.slack_channel_id = d.slack_channel
);