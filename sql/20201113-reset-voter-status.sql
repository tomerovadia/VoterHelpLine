--- repeat this after each election

WITH latest_status AS (
    SELECT
        *
        , row_number () OVER (PARTITION BY user_id, twilio_phone_number ORDER BY created_at DESC) AS rn
    FROM voter_status_updates
)
INSERT INTO voter_status_updates (created_at, user_id, user_phone_number, twilio_phone_number, is_demo, voter_status)
SELECT now(), user_id, user_phone_number, twilio_phone_number, is_demo, 'REGISTERED'
FROM latest_status
WHERE rn = 1 AND voter_status IN ('REQUESTED_BALLOT', 'RECEIVED_BALLOT', 'IN_PERSON', 'VOTED');
