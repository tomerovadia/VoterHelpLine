--- add twilio_phone_number to threads
ALTER TABLE threads
ADD COLUMN twilio_phone_number varchar(12);

--- populate it (run this *after* the new code deploys if under load)
UPDATE threads
SET twilio_phone_number=(
    SELECT from_phone_number FROM messages WHERE is_demo=threads.is_demo ORDER BY twilio_receive_timestamp DESC limit 1
)
;
