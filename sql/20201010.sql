-- Store the array of slack_files as a jsonb colum. We use jsonb rather than
-- a text array because they have similar performance, but JSON is easier to
-- sync to a Redshift data warehouse (e.g. Civis)
ALTER TABLE messages
ADD COLUMN slack_files jsonb;
