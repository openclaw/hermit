ALTER TABLE helper_events
ADD COLUMN event_type TEXT NOT NULL DEFAULT 'helper_command';

UPDATE helper_events
SET event_type = 'helper_command'
WHERE event_type IS NULL OR TRIM(event_type) = '';

CREATE INDEX IF NOT EXISTS idx_helper_events_event_type ON helper_events(event_type);
CREATE INDEX IF NOT EXISTS idx_helper_events_thread_time ON helper_events(thread_id, event_time DESC);

CREATE TABLE IF NOT EXISTS tracked_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_checked TEXT,
  solved INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracked_threads_solved ON tracked_threads(solved);
CREATE INDEX IF NOT EXISTS idx_tracked_threads_last_checked ON tracked_threads(last_checked DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_threads_received_at ON tracked_threads(received_at DESC);
