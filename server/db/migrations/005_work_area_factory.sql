-- Unresolved legacy areas remain unassigned until their owner is confirmed.
ALTER TABLE work_areas ADD COLUMN factory_id TEXT REFERENCES factories(id);
CREATE INDEX idx_work_areas_factory ON work_areas(factory_id, status);
