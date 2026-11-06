CREATE TABLE ticket_pricing (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
  method TEXT CHECK (method IN ('quantity_unit', 'lump_sum')),
  unit TEXT,
  unit_price_micros INTEGER CHECK (unit_price_micros >= 0),
  lump_sum_cents INTEGER CHECK (lump_sum_cents >= 0),
  source_price_id TEXT REFERENCES price_rule_versions(id),
  revision INTEGER NOT NULL DEFAULT 1,
  confirmed_by TEXT REFERENCES accounts(id),
  confirmed_at TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status = 'pending' OR
    (method = 'quantity_unit' AND unit IS NOT NULL AND unit_price_micros IS NOT NULL AND lump_sum_cents IS NULL) OR
    (method = 'lump_sum' AND lump_sum_cents IS NOT NULL AND unit_price_micros IS NULL))
);

CREATE INDEX idx_ticket_pricing_status ON ticket_pricing(status);
