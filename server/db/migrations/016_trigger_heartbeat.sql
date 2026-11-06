CREATE TABLE ticket_trigger_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen TEXT NOT NULL
);
