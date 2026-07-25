UPDATE `form_submissions`
SET
	`status` = 'submitted',
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `status` = 'locked';
