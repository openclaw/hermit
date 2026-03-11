ALTER TABLE tracked_threads
ADD COLUMN warning_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tracked_threads
ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tracked_threads
ADD COLUMN last_message_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_tracked_threads_closed ON tracked_threads(closed);
CREATE INDEX IF NOT EXISTS idx_tracked_threads_warning_level ON tracked_threads(warning_level);
