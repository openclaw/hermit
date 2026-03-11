CREATE TABLE IF NOT EXISTS helper_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  message_count INTEGER,
  event_time TEXT NOT NULL,
  command TEXT NOT NULL,
  invoked_by_id TEXT,
  invoked_by_username TEXT,
  invoked_by_global_name TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_helper_events_event_time ON helper_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_helper_events_command ON helper_events(command);
CREATE INDEX IF NOT EXISTS idx_helper_events_thread_id ON helper_events(thread_id);
CREATE INDEX IF NOT EXISTS idx_helper_events_invoked_by_id ON helper_events(invoked_by_id);
