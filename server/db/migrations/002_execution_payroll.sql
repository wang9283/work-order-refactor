ALTER TABLE payroll_accruals ADD COLUMN adjustment_of_id TEXT REFERENCES payroll_accruals(id);
ALTER TABLE payroll_accruals ADD COLUMN adjustment_reason TEXT;
ALTER TABLE payroll_accruals ADD COLUMN confirmed_at TEXT;
ALTER TABLE payroll_accruals ADD COLUMN confirmed_by TEXT;
ALTER TABLE tickets ADD COLUMN ticket_type_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN form_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN site_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ticket_assignments ADD COLUMN person_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_categories ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));
ALTER TABLE form_templates ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));
ALTER TABLE ticket_types ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));

CREATE TABLE ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  account_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE payroll_company_confirmations (
  id TEXT PRIMARY KEY,
  work_month TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  payroll_company_id TEXT NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'superseded')),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (work_month, person_id)
);

CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, created_at);
CREATE INDEX idx_payroll_confirm_period ON payroll_company_confirmations(work_month, payroll_company_id, status);
CREATE INDEX idx_accruals_person_period ON payroll_accruals(person_id, work_month, settlement_status);
CREATE INDEX idx_accruals_adjustment ON payroll_accruals(adjustment_of_id);
