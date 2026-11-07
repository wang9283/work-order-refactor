ALTER TABLE sessions ADD COLUMN selected_org_node_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_demo_org
  ON sessions(demo_identity_id, selected_org_node_id);
