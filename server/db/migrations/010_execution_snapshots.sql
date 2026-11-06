ALTER TABLE tickets ADD COLUMN price_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ticket_assignments ADD COLUMN person_snapshot_json TEXT NOT NULL DEFAULT '{}';

-- Preserve the best information available at upgrade time. Older databases
-- never stored names or price values for these fields, so their creation-time
-- values cannot be reconstructed if master data was already changed.
UPDATE tickets SET site_snapshot_json = json_insert(
  CASE WHEN json_valid(site_snapshot_json) THEN site_snapshot_json ELSE '{}' END,
  '$.siteName', (SELECT name FROM production_bases WHERE id = tickets.site_id),
  '$.factoryName', (SELECT name FROM factories WHERE id = tickets.factory_id),
  '$.workAreaName', (SELECT name FROM work_areas WHERE id = tickets.work_area_id),
  '$.productionLineName', (SELECT name FROM production_lines WHERE id = tickets.production_line_id),
  '$.crewName', (SELECT name FROM crews WHERE id = tickets.crew_id),
  '$.shiftName', (SELECT name FROM shift_templates WHERE id = tickets.shift_template_id),
  '$.handoverName', (SELECT name FROM handover_shift_profiles WHERE id = tickets.handover_shift_profile_id)
);
UPDATE tickets SET price_snapshot_json = COALESCE((SELECT json_object(
  'id', p.id, 'versionNo', p.version_no, 'unit', p.unit, 'unitPriceMicros', p.unit_price_micros,
  'effectiveFrom', p.effective_from, 'effectiveTo', p.effective_to)
  FROM price_rule_versions p WHERE p.id = tickets.price_rule_version_id), '{}');
UPDATE ticket_assignments SET person_snapshot_json = COALESCE((SELECT json_object(
  'id', p.id, 'name', COALESCE(NULLIF(ticket_assignments.person_name_snapshot, ''), p.name),
  'employeeCode', p.employee_code, 'homeCompanyId', p.home_company_id, 'homeBaseId', p.home_base_id,
  'factoryId', p.factory_id, 'source', ticket_assignments.assignment_source)
  FROM people p WHERE p.id = ticket_assignments.person_id), '{}');
