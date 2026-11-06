ALTER TABLE sessions ADD COLUMN demo_identity_id TEXT;
ALTER TABLE sessions ADD COLUMN selected_base_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_demo_scope
  ON sessions(demo_identity_id, selected_base_id);
