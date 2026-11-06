-- A person may belong to only one crew on any given date.
-- The guard aborts the migration when an existing database already holds
-- overlapping memberships, so nothing is silently rewritten.
CREATE INDEX IF NOT EXISTS idx_crew_memberships_person_dates
  ON crew_memberships (person_id, valid_from, valid_to);

CREATE TEMP TABLE _crew_membership_guard (flag INTEGER);
CREATE TEMP TRIGGER _crew_membership_guard_block
BEFORE INSERT ON _crew_membership_guard
BEGIN
  SELECT RAISE(ABORT, '存在跨班组重叠的成员关系，请先人工处理后再升级');
END;
INSERT INTO _crew_membership_guard (flag)
  SELECT 1
    FROM crew_memberships a
    JOIN crew_memberships b ON b.person_id = a.person_id AND b.id > a.id
   WHERE a.valid_from <= COALESCE(b.valid_to, '9999-12-31')
     AND COALESCE(a.valid_to, '9999-12-31') >= b.valid_from
   LIMIT 1;
DROP TRIGGER _crew_membership_guard_block;
DROP TABLE _crew_membership_guard;

DROP TRIGGER IF EXISTS crew_memberships_unique_insert;
CREATE TRIGGER crew_memberships_unique_insert
BEFORE INSERT ON crew_memberships
BEGIN
  SELECT RAISE(ABORT, '该人员在所选日期内已属于其他班组，请先结束原班组关系')
   WHERE EXISTS (
     SELECT 1 FROM crew_memberships o
      -- Ignore the row's own id so re-running the seed (INSERT OR IGNORE) stays a no-op
      -- instead of treating the existing duplicate as a conflict.
      WHERE o.person_id = NEW.person_id
        AND o.id <> NEW.id
        AND o.valid_from <= COALESCE(NEW.valid_to, '9999-12-31')
        AND COALESCE(o.valid_to, '9999-12-31') >= NEW.valid_from
   );
END;

DROP TRIGGER IF EXISTS crew_memberships_unique_update;
CREATE TRIGGER crew_memberships_unique_update
BEFORE UPDATE OF person_id, valid_from, valid_to ON crew_memberships
BEGIN
  SELECT RAISE(ABORT, '该人员在所选日期内已属于其他班组，请先结束原班组关系')
   WHERE EXISTS (
     SELECT 1 FROM crew_memberships o
      WHERE o.id <> OLD.id
        AND o.person_id = NEW.person_id
        AND o.valid_from <= COALESCE(NEW.valid_to, '9999-12-31')
        AND COALESCE(o.valid_to, '9999-12-31') >= NEW.valid_from
   );
END;
