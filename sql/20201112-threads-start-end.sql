--- add start_at, end_at columns to threads
ALTER TABLE threads
ADD COLUMN session_start_at timestamptz;
ALTER TABLE threads
ADD COLUMN session_end_at timestamptz;

UPDATE threads t
SET session_start_at = (
    SELECT MIN(twilio_receive_timestamp) FROM messages m
    WHERE
        m.user_id = t.user_id
        AND m.from_phone_number = t.user_phone_number
        AND m.direction = 'INBOUND'
);
