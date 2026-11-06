CREATE TABLE org_nodes (
 id TEXT PRIMARY KEY, parent_id TEXT REFERENCES org_nodes(id), code TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, factory_id TEXT REFERENCES factories(id), payroll_company_id TEXT REFERENCES companies(id),
 pricing_site_id TEXT REFERENCES production_bases(id), status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO org_nodes(id,parent_id,code,name,status,created_at,updated_at)
 SELECT id,NULL,'ORG-' || code,name,status,created_at,updated_at FROM management_groups;
INSERT INTO org_nodes(id,parent_id,code,name,factory_id,payroll_company_id,pricing_site_id,status,created_at,updated_at)
 SELECT id,management_group_id,code,name,id,company_id,base_id,status,created_at,updated_at FROM factories;
-- Preserve old line IDs for tickets and references; expose them as ordinary child locations.
INSERT INTO work_areas(id,code,name,base_id,factory_id,parent_id,manager_person_id,status,revision,created_at,created_by,updated_at,updated_by)
 SELECT l.id, 'LOC-' || l.code,l.name,l.base_id,a.factory_id,l.work_area_id,NULL,l.status,l.revision,l.created_at,l.created_by,l.updated_at,l.updated_by
 FROM production_lines l JOIN work_areas a ON a.id=l.work_area_id;
INSERT INTO crew_scopes(id,crew_id,work_area_id,production_line_id)
 SELECT 'loc-' || id,crew_id,production_line_id,NULL FROM crew_scopes WHERE production_line_id IS NOT NULL;
