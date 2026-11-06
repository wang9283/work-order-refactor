-- 产品（物料档案）主数据：物料类别（产线）决定价格维度，产品决定参与工序/岗位。
CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  abbr TEXT,
  spec TEXT,
  model TEXT,
  material_type_id TEXT NOT NULL REFERENCES business_catalog(id),
  small_pack INTEGER NOT NULL DEFAULT 0 CHECK (small_pack IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (code)
);

CREATE TABLE material_post_flags (
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  post_catalog_id TEXT NOT NULL REFERENCES business_catalog(id),
  PRIMARY KEY (material_id, post_catalog_id)
);

ALTER TABLE tickets ADD COLUMN material_id TEXT REFERENCES materials(id);
ALTER TABLE tickets ADD COLUMN material_name_snapshot TEXT;
