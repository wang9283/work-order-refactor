PRAGMA defer_foreign_keys = ON;

CREATE TABLE payroll_accruals_new (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  work_site_id TEXT NOT NULL REFERENCES production_bases(id),
  price_rule_version_id TEXT REFERENCES price_rule_versions(id),
  quantity REAL,
  amount_micros INTEGER NOT NULL,
  work_month TEXT NOT NULL,
  payroll_company_id TEXT REFERENCES companies(id),
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('open', 'locked', 'adjusted')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  adjustment_of_id TEXT REFERENCES payroll_accruals_new(id),
  adjustment_reason TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT
);

INSERT INTO payroll_accruals_new
  (id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity, amount_micros,
   work_month, payroll_company_id, settlement_status, revision, created_at, updated_at,
   adjustment_of_id, adjustment_reason, confirmed_at, confirmed_by)
SELECT id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity, amount_micros,
   work_month, payroll_company_id, settlement_status, revision, created_at, updated_at,
   adjustment_of_id, adjustment_reason, confirmed_at, confirmed_by
FROM payroll_accruals;

UPDATE payroll_accruals SET adjustment_of_id = NULL WHERE adjustment_of_id IS NOT NULL;
DROP TABLE payroll_accruals;
ALTER TABLE payroll_accruals_new RENAME TO payroll_accruals;
CREATE INDEX idx_accruals_period_company ON payroll_accruals(work_month, payroll_company_id, settlement_status);
CREATE INDEX idx_accruals_person_period ON payroll_accruals(person_id, work_month, settlement_status);
CREATE INDEX idx_accruals_adjustment ON payroll_accruals(adjustment_of_id);
