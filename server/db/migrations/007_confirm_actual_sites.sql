-- An old "base" may actually be an administrative grouping. Existing rows
-- require explicit review; new real locations are marked confirmed at creation.
ALTER TABLE production_bases ADD COLUMN site_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (site_confirmed IN (0, 1));
