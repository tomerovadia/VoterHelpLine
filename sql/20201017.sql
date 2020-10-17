--- add index to speed up unclaimed query (which filters out REFUSED|SPAM)
CREATE INDEX voter_status_updates_user_id_created_at
ON voter_status_updates(user_id, created_at DESC);