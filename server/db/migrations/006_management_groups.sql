-- A management group is not a production base and cannot be used for pricing.
CREATE TABLE management_groups (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Legacy factory classifications are deliberately left unresolved.
ALTER TABLE factories ADD COLUMN management_group_id TEXT REFERENCES management_groups(id);
CREATE INDEX idx_factories_management_group ON factories(management_group_id, status);
