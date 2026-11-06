CREATE TABLE crew_scopes (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id),
  work_area_id TEXT REFERENCES work_areas(id),
  production_line_id TEXT REFERENCES production_lines(id),
  CHECK ((work_area_id IS NOT NULL) <> (production_line_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_crew_scope_area ON crew_scopes(crew_id, work_area_id) WHERE work_area_id IS NOT NULL;
CREATE UNIQUE INDEX idx_crew_scope_line ON crew_scopes(crew_id, production_line_id) WHERE production_line_id IS NOT NULL;
