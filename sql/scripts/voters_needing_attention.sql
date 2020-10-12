SELECT
	voters.user_id, 
	most_recent_voter_message.slack_channel, 
	first_voter_message.timestamp - interval '4 hours' AS first_voter_message_timestamp_est,
	NOW()::timestamp - first_voter_message.timestamp AS time_since_first_voter_message,
	'https://voteamericahelpline.slack.com/archives/' || most_recent_voter_message.slack_channel || '/p' || TRANSLATE(most_recent_voter_message.slack_parent_message_ts::text, '.', '') AS slack_link
FROM (SELECT user_id
	FROM messages
	WHERE NOT is_demo AND (to_phone_number = '48298' OR from_phone_number = '48298')
	GROUP BY user_id
	HAVING 
		-- The voter has a Slack channel...
		BOOL_OR(slack_channel IS NOT NULL)
		-- 	...the voter's latest status it not REFUSED or SPAM
		AND user_id NOT IN (SELECT DISTINCT ON (user_id) user_id
								FROM voter_status_updates
								WHERE voter_status IN ('REFUSED', 'SPAM')
								ORDER BY user_id, created_at DESC)
		-- and either a Slack user hasn't messaged this voter
		AND (BOOL_AND(originating_slack_user_id IS NULL)
			-- ...or the voter hasn't been claimed.
			OR user_id NOT IN (SELECT DISTINCT user_id FROM volunteer_voter_claims))) AS voters
LEFT JOIN 
	(SELECT DISTINCT ON (user_id) user_id, slack_channel, slack_parent_message_ts
	FROM messages
	WHERE slack_channel IS NOT NULL
	ORDER BY user_id, twilio_receive_timestamp DESC) AS most_recent_voter_message
ON voters.user_id = most_recent_voter_message.user_id
LEFT JOIN
	(SELECT DISTINCT ON (user_id) user_id, twilio_receive_timestamp AS timestamp
	FROM messages
	-- Only include messages after voter says 'helpline' (inclusive)
	WHERE slack_channel IS NOT NULL
	ORDER BY user_id, twilio_receive_timestamp ASC) AS first_voter_message
ON voters.user_id = first_voter_message.user_id
ORDER BY first_voter_message.timestamp ASC;
