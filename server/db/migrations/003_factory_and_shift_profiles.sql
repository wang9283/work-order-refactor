ALTER TABLE crews ADD COLUMN factory_id TEXT REFERENCES factories(id);
ALTER TABLE people ADD COLUMN factory_id TEXT REFERENCES factories(id);
ALTER TABLE work_profiles ADD COLUMN factory_id TEXT REFERENCES factories(id);
ALTER TABLE work_profiles ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE tickets ADD COLUMN factory_id TEXT REFERENCES factories(id);

CREATE INDEX idx_factories_base ON factories(base_id, status, sort_order);
CREATE INDEX idx_crews_factory ON crews(factory_id, status);
CREATE INDEX idx_people_factory ON people(factory_id, status);
CREATE INDEX idx_work_profiles_factory ON work_profiles(factory_id, site_id, status);
CREATE INDEX idx_tickets_factory ON tickets(factory_id, work_date, status);

CREATE TABLE handover_shift_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  factory_id TEXT NOT NULL REFERENCES factories(id),
  shift_template_id TEXT NOT NULL REFERENCES shift_templates(id),
  assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('roster_first', 'manual')),
  handover_required INTEGER NOT NULL DEFAULT 1 CHECK (handover_required IN (0, 1)),
  early_start_minutes INTEGER NOT NULL DEFAULT 30,
  late_end_minutes INTEGER NOT NULL DEFAULT 30,
  instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (factory_id, shift_template_id, name)
);

CREATE TABLE handover_shift_profile_crews (
  profile_id TEXT NOT NULL REFERENCES handover_shift_profiles(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL REFERENCES crews(id),
  PRIMARY KEY (profile_id, crew_id)
);

ALTER TABLE tickets ADD COLUMN handover_shift_profile_id TEXT REFERENCES handover_shift_profiles(id);

CREATE INDEX idx_handover_profiles_factory ON handover_shift_profiles(factory_id, status);
CREATE INDEX idx_handover_profile_crews_crew ON handover_shift_profile_crews(crew_id);
