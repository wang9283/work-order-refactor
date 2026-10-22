PRAGMA foreign_keys = ON;

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  is_group INTEGER NOT NULL DEFAULT 0 CHECK (is_group IN (0, 1)),
  payroll_enabled INTEGER NOT NULL DEFAULT 1 CHECK (payroll_enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE production_bases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE work_areas (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES production_bases(id),
  parent_id TEXT REFERENCES work_areas(id),
  manager_person_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE production_lines (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES production_bases(id),
  work_area_id TEXT NOT NULL REFERENCES work_areas(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE qualifications (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  home_company_id TEXT NOT NULL REFERENCES companies(id),
  home_base_id TEXT NOT NULL REFERENCES production_bases(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE person_qualifications (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  qualification_id TEXT NOT NULL REFERENCES qualifications(id),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  certificate_no TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (person_id, qualification_id, valid_from)
);

CREATE TABLE crews (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES production_bases(id),
  work_area_id TEXT NOT NULL REFERENCES work_areas(id),
  leader_person_id TEXT REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE crew_memberships (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES crews(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (role IN ('leader', 'operator', 'support')),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE secondments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  from_company_id TEXT NOT NULL REFERENCES companies(id),
  from_base_id TEXT NOT NULL REFERENCES production_bases(id),
  to_company_id TEXT NOT NULL REFERENCES companies(id),
  to_base_id TEXT NOT NULL REFERENCES production_bases(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  approved_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  CHECK (start_date <= end_date)
);

CREATE TABLE shift_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES production_bases(id),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  cross_day INTEGER NOT NULL DEFAULT 0 CHECK (cross_day IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (base_id, code)
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_capabilities (
  role_id TEXT NOT NULL REFERENCES roles(id),
  capability TEXT NOT NULL,
  PRIMARY KEY (role_id, capability)
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'company', 'base', 'work_area')),
  scope_id TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE ticket_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('group', 'company')),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (owner_type, owner_id, code)
);

CREATE TABLE form_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('group', 'company')),
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'native' CHECK (source IN ('native', 'excel')),
  current_published_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (owner_type, owner_id, code)
);

CREATE TABLE form_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES form_templates(id),
  version_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  schema_json TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (template_id, version_no)
);

CREATE TABLE ticket_types (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES ticket_categories(id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('group', 'company')),
  owner_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('group_standard', 'local')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired', 'archived')),
  current_version_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (owner_type, owner_id, code)
);

CREATE TABLE ticket_type_versions (
  id TEXT PRIMARY KEY,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  version_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  form_version_id TEXT NOT NULL REFERENCES form_versions(id),
  published_at TEXT,
  published_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (ticket_type_id, version_no)
);

CREATE TABLE work_profiles (
  id TEXT PRIMARY KEY,
  ticket_type_version_id TEXT NOT NULL REFERENCES ticket_type_versions(id),
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  work_area_id TEXT REFERENCES work_areas(id),
  production_line_id TEXT REFERENCES production_lines(id),
  crew_id TEXT REFERENCES crews(id),
  shift_template_id TEXT REFERENCES shift_templates(id),
  generation_mode TEXT NOT NULL CHECK (generation_mode IN ('manual', 'api', 'schedule')),
  handover_grouping TEXT NOT NULL CHECK (handover_grouping IN ('none', 'shift', 'day')),
  handover_required INTEGER NOT NULL DEFAULT 1 CHECK (handover_required IN (0, 1)),
  time_window_start TEXT,
  time_window_end TEXT,
  early_start_minutes INTEGER NOT NULL DEFAULT 0,
  late_end_minutes INTEGER NOT NULL DEFAULT 0,
  assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('roster_first', 'qualification', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  ticket_no TEXT NOT NULL UNIQUE,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  ticket_type_version_id TEXT NOT NULL REFERENCES ticket_type_versions(id),
  form_version_id TEXT NOT NULL REFERENCES form_versions(id),
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  work_area_id TEXT REFERENCES work_areas(id),
  production_line_id TEXT REFERENCES production_lines(id),
  crew_id TEXT REFERENCES crews(id),
  shift_template_id TEXT REFERENCES shift_templates(id),
  status TEXT NOT NULL,
  work_date TEXT NOT NULL,
  event_time TEXT NOT NULL,
  deadline_at TEXT,
  values_json TEXT NOT NULL DEFAULT '{}',
  sub_form_values_json TEXT NOT NULL DEFAULT '{}',
  price_rule_version_id TEXT,
  quantity REAL,
  amount_micros INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE ticket_assignments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL CHECK (role IN ('lead', 'member')),
  assignment_source TEXT NOT NULL CHECK (assignment_source IN ('roster', 'manual', 'secondment')),
  planned_quantity REAL,
  actual_quantity REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (ticket_id, person_id)
);

CREATE TABLE price_rule_versions (
  id TEXT PRIMARY KEY,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  site_id TEXT NOT NULL REFERENCES production_bases(id),
  version_no INTEGER NOT NULL,
  unit TEXT NOT NULL,
  unit_price_micros INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE (ticket_type_id, site_id, version_no)
);

CREATE TABLE payroll_periods (
  id TEXT PRIMARY KEY,
  work_month TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('open', 'closing', 'closed', 'reopened')),
  closed_at TEXT,
  closed_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payroll_accruals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  work_site_id TEXT NOT NULL REFERENCES production_bases(id),
  price_rule_version_id TEXT NOT NULL REFERENCES price_rule_versions(id),
  quantity REAL NOT NULL,
  amount_micros INTEGER NOT NULL,
  work_month TEXT NOT NULL,
  payroll_company_id TEXT REFERENCES companies(id),
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('open', 'locked', 'adjusted')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE excel_import_jobs (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('group', 'company')),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'mapped', 'draft_created', 'failed')),
  columns_json TEXT NOT NULL,
  source_path TEXT NOT NULL,
  draft_form_template_id TEXT REFERENCES form_templates(id),
  draft_form_version_id TEXT REFERENCES form_versions(id),
  error_message TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  scope_type TEXT,
  scope_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_bases_company ON production_bases(company_id, status);
CREATE INDEX idx_work_areas_base ON work_areas(base_id, status);
CREATE INDEX idx_lines_work_area ON production_lines(work_area_id, status);
CREATE INDEX idx_people_home_base ON people(home_base_id, status);
CREATE INDEX idx_secondments_person_dates ON secondments(person_id, start_date, end_date, status);
CREATE INDEX idx_secondments_to_base_dates ON secondments(to_base_id, start_date, end_date, status);
CREATE INDEX idx_role_assignments_account ON role_assignments(account_id, scope_type, scope_id);
CREATE INDEX idx_form_versions_template ON form_versions(template_id, status);
CREATE INDEX idx_ticket_types_owner ON ticket_types(owner_type, owner_id, status);
CREATE INDEX idx_ticket_type_versions_type ON ticket_type_versions(ticket_type_id, status);
CREATE INDEX idx_tickets_context ON tickets(site_id, work_area_id, status, work_date);
CREATE INDEX idx_tickets_person ON ticket_assignments(person_id, ticket_id);
CREATE INDEX idx_accruals_period_company ON payroll_accruals(work_month, payroll_company_id, settlement_status);
