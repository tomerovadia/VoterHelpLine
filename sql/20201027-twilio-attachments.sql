-- Store the array of slack_attachments as a jsonb column. We use jsonb rather than
-- a text array because they have similar performance, but JSON is easier to
-- sync to a Redshift data warehouse (e.g. Civis)
ALTER TABLE messages
ADD COLUMN twilio_attachments jsonb;
