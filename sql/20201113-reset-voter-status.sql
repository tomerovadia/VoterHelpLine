--- repeat this after each election

--- First query will insert new REGISTERED update.  Note that it will obscure a prior SPAM or REFUSED!

WITH latest_status AS (
    SELECT
        *
        , row_number () OVER (PARTITION BY user_id, twilio_phone_number ORDER BY created_at DESC) AS rn
    FROM voter_status_updates
    WHERE voter_status NOT IN ('REFUSED', 'SPAM', 'REJOIN')
)
INSERT INTO voter_status_updates (created_at, user_id, user_phone_number, twilio_phone_number, is_demo, voter_status)
SELECT now(), user_id, user_phone_number, twilio_phone_number, is_demo, 'REGISTERED'
FROM latest_status
WHERE rn = 1 AND voter_status IN ('REQUESTED_BALLOT', 'RECEIVED_BALLOT', 'IN_PERSON', 'VOTED', 'NOT_VOTING');


--- re-add REFUSED or SPAM as needed
--- NOTE: this query must run within 10 minutes of the first query

WITH latest_status AS (
    SELECT
        *
        , row_number () OVER (PARTITION BY user_id, twilio_phone_number ORDER BY created_at DESC) AS rn
    FROM voter_status_updates
    WHERE
        created_at < NOW() - interval '10 minutes'
)
INSERT INTO voter_status_updates (created_at, user_id, user_phone_number, twilio_phone_number, is_demo, voter_status)
SELECT now(), user_id, user_phone_number, twilio_phone_number, is_demo, voter_status
FROM latest_status
WHERE
    rn = 1
    AND voter_status IN ('REFUSED', 'SPAM')
    AND EXISTS (
        SELECT 1 FROM voter_status_updates
        WHERE 
            user_id=latest_status.user_id
            AND twilio_phone_number=latest_status.twilio_phone_number
            AND created_at > NOW() - interval '10 minutes'
            AND voter_status='REGISTERED'
    )