--- ALREADY_VOTED -> VOTED
UPDATE voter_status_updates SET voter_status='VOTED' where voter_status='ALREADY_VOTED';
