import type { DatabaseSync } from 'node:sqlite'

/** Repair installations which applied the early 018 schema before name snapshots were introduced. */
export function addBusinessSnapshotColumns(db: DatabaseSync): void {
  const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map((row) => row.name)
  if (!ticketColumns.includes('material_type_name_snapshot')) db.exec('ALTER TABLE tickets ADD COLUMN material_type_name_snapshot TEXT')
  const itemColumns = db.prepare('PRAGMA table_info(ticket_business_work_items)').all().map((row) => row.name)
  if (!itemColumns.includes('catalog_name_snapshot')) db.exec("ALTER TABLE ticket_business_work_items ADD COLUMN catalog_name_snapshot TEXT NOT NULL DEFAULT ''")
  db.exec(`UPDATE tickets SET material_type_name_snapshot = (SELECT name FROM business_catalog WHERE id = tickets.material_type_id)
    WHERE business_kind = 'production' AND material_type_name_snapshot IS NULL;
    UPDATE ticket_business_work_items SET catalog_name_snapshot = COALESCE((SELECT name FROM business_catalog WHERE id = ticket_business_work_items.catalog_id), '')
    WHERE catalog_name_snapshot = '';`)
}
