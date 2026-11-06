CREATE TABLE ticket_trigger_cursors (
  rule_id TEXT PRIMARY KEY REFERENCES ticket_trigger_rules(id),
  scanned_until TEXT NOT NULL
);
INSERT INTO ticket_trigger_cursors (rule_id, scanned_until)
  SELECT id, updated_at FROM ticket_trigger_rules;
