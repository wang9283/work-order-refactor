CREATE TABLE ticket_trigger_rules (
  id TEXT PRIMARY KEY,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  factory_id TEXT NOT NULL REFERENCES factories(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  current_version INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ticket_trigger_versions (
  rule_id TEXT NOT NULL REFERENCES ticket_trigger_rules(id),
  version INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('schedule', 'event')),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (rule_id, version)
);

CREATE TABLE ticket_trigger_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  occurrence_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('schedule', 'event')),
  scheduled_at TEXT,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('missed', 'failed', 'succeeded')),
  error_message TEXT,
  ticket_id TEXT REFERENCES tickets(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (rule_id, rule_version) REFERENCES ticket_trigger_versions(rule_id, version),
  UNIQUE (rule_id, occurrence_key)
);

CREATE INDEX idx_ticket_trigger_runs_rule ON ticket_trigger_runs(rule_id, created_at);
