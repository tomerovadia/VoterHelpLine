--- record voter topic selections

CREATE TABLE session_topics (
  created_at TIMESTAMPTZ NOT NULL,
  user_id TEXT NOT NULL,
  user_phone_number TEXT NOT NULL,
  twilio_phone_number TEXT NOT NULL,
  session_start_at TIMESTAMPTZ NOT NULL,
  is_demo BOOLEAN,
  archived BOOLEAN,
  topics JSONB,
  PRIMARY KEY (created_at, user_id, twilio_phone_number, session_start_at)
);
