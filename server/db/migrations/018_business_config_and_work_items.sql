CREATE TABLE business_catalog (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material_type', 'production_post', 'loading_type')),
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (kind, code)
);

ALTER TABLE form_templates ADD COLUMN system_managed INTEGER NOT NULL DEFAULT 0 CHECK (system_managed IN (0, 1));
ALTER TABLE ticket_types ADD COLUMN system_managed INTEGER NOT NULL DEFAULT 0 CHECK (system_managed IN (0, 1));
ALTER TABLE ticket_types ADD COLUMN business_kind TEXT CHECK (business_kind IS NULL OR business_kind IN ('production', 'loading'));

ALTER TABLE tickets ADD COLUMN business_kind TEXT NOT NULL DEFAULT 'generic'
  CHECK (business_kind IN ('generic', 'production', 'loading'));
ALTER TABLE tickets ADD COLUMN material_type_id TEXT REFERENCES business_catalog(id);
ALTER TABLE tickets ADD COLUMN business_config_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN material_type_name_snapshot TEXT;

CREATE TABLE site_business_config_meta (
  site_id TEXT PRIMARY KEY REFERENCES production_bases(id),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE site_business_config_items (
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  catalog_id TEXT NOT NULL REFERENCES business_catalog(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (site_id, catalog_id)
);

CREATE TABLE business_price_rule_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  kind TEXT NOT NULL CHECK (kind IN ('production', 'loading')),
  catalog_id TEXT NOT NULL REFERENCES business_catalog(id),
  material_type_id TEXT REFERENCES business_catalog(id),
  version_no INTEGER NOT NULL,
  unit TEXT NOT NULL,
  unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'retired')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (site_id, kind, catalog_id, material_type_id, version_no)
);

CREATE INDEX idx_business_price_current_dimension
  ON business_price_rule_versions(site_id, kind, catalog_id, COALESCE(material_type_id, ''));
CREATE INDEX idx_business_price_lookup
  ON business_price_rule_versions(site_id, kind, catalog_id, effective_from, effective_to);

CREATE TABLE ticket_business_work_items (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('production_post', 'loading_type')),
  catalog_id TEXT NOT NULL REFERENCES business_catalog(id),
  catalog_name_snapshot TEXT NOT NULL,
  price_rule_version_id TEXT REFERENCES business_price_rule_versions(id),
  price_status TEXT NOT NULL CHECK (price_status IN ('pending', 'confirmed')),
  unit TEXT NOT NULL,
  unit_price_micros INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (ticket_id, kind, catalog_id),
  CHECK ((price_status = 'pending' AND unit_price_micros IS NULL)
    OR (price_status = 'confirmed' AND unit_price_micros IS NOT NULL))
);

CREATE TABLE ticket_business_work_item_assignments (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES ticket_business_work_items(id),
  ticket_assignment_id TEXT NOT NULL REFERENCES ticket_assignments(id),
  share_basis_points INTEGER NOT NULL CHECK (share_basis_points BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  UNIQUE (work_item_id, ticket_assignment_id)
);

CREATE INDEX idx_ticket_business_work_items_ticket ON ticket_business_work_items(ticket_id);
CREATE INDEX idx_ticket_business_work_item_assignments_item ON ticket_business_work_item_assignments(work_item_id);

ALTER TABLE payroll_accruals ADD COLUMN business_work_item_id TEXT REFERENCES ticket_business_work_items(id);
CREATE INDEX idx_accruals_business_work_item ON payroll_accruals(business_work_item_id);

INSERT OR IGNORE INTO role_capabilities (role_id, capability)
SELECT id, 'business_catalog.manage' FROM roles WHERE code = 'group_admin';
