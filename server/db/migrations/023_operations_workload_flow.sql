CREATE TABLE operations_rosters (
  id TEXT PRIMARY KEY,
  work_date TEXT NOT NULL,
  shift_template_id TEXT NOT NULL REFERENCES shift_templates(id),
  crew_id TEXT NOT NULL REFERENCES crews(id),
  assignments_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL CHECK (source IN ('monthly','daily')),
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES accounts(id),
  UNIQUE (work_date, shift_template_id, crew_id)
);
CREATE INDEX idx_operations_rosters_date ON operations_rosters(work_date, crew_id);

-- Source/confirmation/feedback metadata references the existing work-order ledger.
CREATE TABLE operations_ticket_sources (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),
  source TEXT NOT NULL CHECK (source IN ('self','demo_sync')),
  source_namespace TEXT NOT NULL,
  source_key TEXT NOT NULL,
  roster_snapshot_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (source_namespace, source_key)
);
ALTER TABLE ticket_assignments ADD COLUMN share_basis_points INTEGER
  CHECK (share_basis_points IS NULL OR share_basis_points BETWEEN 0 AND 10000);

CREATE TABLE operations_confirmations (
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (ticket_id, person_id)
);
CREATE TABLE operations_feedback (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  response TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES accounts(id)
);
CREATE INDEX idx_operations_feedback_ticket ON operations_feedback(ticket_id, status);
