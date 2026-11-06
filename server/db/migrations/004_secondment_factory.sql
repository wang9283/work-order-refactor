-- Existing records deliberately remain unresolved until an authorized user
-- identifies the receiving factory. Do not infer it from the number of mills.
ALTER TABLE secondments ADD COLUMN to_factory_id TEXT REFERENCES factories(id);
CREATE INDEX idx_secondments_to_factory_dates ON secondments(to_factory_id, start_date, end_date, status);
