ALTER TABLE management_groups ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE management_groups ADD COLUMN created_by TEXT;
ALTER TABLE management_groups ADD COLUMN updated_by TEXT;
