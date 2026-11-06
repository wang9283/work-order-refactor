ALTER TABLE operations_rosters ADD COLUMN attribution_date TEXT;
ALTER TABLE operations_rosters ADD COLUMN shift_start_date TEXT;
ALTER TABLE operations_rosters ADD COLUMN shift_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE operations_rosters ADD COLUMN shift_start_time_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE operations_rosters ADD COLUMN shift_end_time_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE operations_rosters ADD COLUMN shift_cross_day_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (shift_cross_day_snapshot IN (0, 1));
UPDATE operations_rosters SET
  attribution_date = work_date,
  shift_start_date = CASE WHEN (SELECT cross_day FROM shift_templates WHERE id = shift_template_id) = 1 THEN date(work_date, '-1 day') ELSE work_date END,
  shift_name_snapshot = (SELECT name FROM shift_templates WHERE id = shift_template_id),
  shift_start_time_snapshot = (SELECT start_time FROM shift_templates WHERE id = shift_template_id),
  shift_end_time_snapshot = (SELECT end_time FROM shift_templates WHERE id = shift_template_id),
  shift_cross_day_snapshot = (SELECT cross_day FROM shift_templates WHERE id = shift_template_id);

CREATE TABLE operations_crew_rules (
  crew_id TEXT PRIMARY KEY REFERENCES crews(id),
  qualification_id TEXT REFERENCES qualifications(id),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES accounts(id)
);
CREATE TABLE operations_assignment_rules (
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  crew_id TEXT NOT NULL REFERENCES crews(id),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (site_id, ticket_type_id)
);

CREATE TABLE operations_sanitation (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('vehicle', 'facility')),
  plate_number TEXT,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES accounts(id),
  started_at TEXT,
  started_by TEXT REFERENCES accounts(id),
  ended_at TEXT,
  ended_by TEXT REFERENCES accounts(id),
  drying_required INTEGER CHECK (drying_required IS NULL OR drying_required IN (0, 1)),
  drying_started_at TEXT,
  drying_ended_at TEXT,
  assignment_issue TEXT
);
CREATE TABLE operations_sanitation_areas (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  area_key TEXT NOT NULL CHECK (area_key IN ('production', 'living', 'office')),
  started_at TEXT,
  started_by TEXT REFERENCES accounts(id),
  completed_at TEXT,
  completed_by TEXT REFERENCES accounts(id),
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (ticket_id, area_key)
);
CREATE TABLE operations_demo_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('vehicle', 'facility')),
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);
CREATE TABLE operations_sanitation_evidence (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  point_key TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES operations_demo_assets(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  UNIQUE (ticket_id, point_key, asset_id)
);
CREATE INDEX idx_sanitation_evidence_ticket ON operations_sanitation_evidence(ticket_id, point_key);
