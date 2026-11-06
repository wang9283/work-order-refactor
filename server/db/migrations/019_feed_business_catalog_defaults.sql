-- Field options are sourced from Feed/Prototype/shared/constants.ts and orderTypes.ts.
-- Bases select their own applicable options; this migration does not enable options or create prices.
WITH defaults(id, kind, code, name) AS (VALUES
  ('feed_mat_poultry', 'material_type', 'FEED-MAT-POULTRY', '畜禽料'),
  ('feed_mat_pig', 'material_type', 'FEED-MAT-PIG', '猪料'),
  ('feed_mat_ruminant', 'material_type', 'FEED-MAT-RUMINANT', '反刍料'),
  ('feed_mat_special_aqua', 'material_type', 'FEED-MAT-SPECIAL-AQUA', '特水料'),
  ('feed_mat_aqua', 'material_type', 'FEED-MAT-AQUA', '普水料'),
  ('feed_mat_fermented', 'material_type', 'FEED-MAT-FERMENTED', '发酵料'),
  ('feed_mat_conditioned', 'material_type', 'FEED-MAT-CONDITIONED', '舒化料'),
  ('feed_mat_creep', 'material_type', 'FEED-MAT-CREEP', '教槽料'),
  ('feed_mat_premix', 'material_type', 'FEED-MAT-PREMIX', '预混料'),
  ('feed_post_feeding', 'production_post', 'FEED-POST-FEEDING', '投料'),
  ('feed_post_batching', 'production_post', 'FEED-POST-BATCHING', '小料配料'),
  ('feed_post_control', 'production_post', 'FEED-POST-CONTROL', '中控'),
  ('feed_post_pelleting', 'production_post', 'FEED-POST-PELLETING', '制粒'),
  ('feed_post_receiving', 'production_post', 'FEED-POST-RECEIVING', '接料'),
  ('feed_post_palletizing', 'production_post', 'FEED-POST-PALLETIZING', '码盘'),
  ('feed_post_transfer', 'production_post', 'FEED-POST-TRANSFER', '转运'),
  ('feed_post_extrusion', 'production_post', 'FEED-POST-EXTRUSION', '膨化/舒化'),
  ('feed_load_raw_bulk', 'loading_type', 'FEED-LOAD-RAW-BULK', '原料卸车-散装自卸'),
  ('feed_load_raw_bag', 'loading_type', 'FEED-LOAD-RAW-BAG', '原料卸车-袋装普通卸车'),
  ('feed_load_raw_container', 'loading_type', 'FEED-LOAD-RAW-CONTAINER', '原料卸车-袋装集装箱卸车'),
  ('feed_load_raw_tonbag', 'loading_type', 'FEED-LOAD-RAW-TONBAG', '原料卸车-散粮装吨袋'),
  ('feed_load_raw_manual', 'loading_type', 'FEED-LOAD-RAW-MANUAL', '原料卸车-散装（吨包）人工卸车'),
  ('feed_load_finished_bag', 'loading_type', 'FEED-LOAD-FINISHED-BAG', '成品装车-袋装装车'),
  ('feed_load_finished_bulk', 'loading_type', 'FEED-LOAD-FINISHED-BULK', '成品装车-散装装车'),
  ('feed_load_finished_container', 'loading_type', 'FEED-LOAD-FINISHED-CONTAINER', '成品装车-集装箱装车')
)
INSERT OR IGNORE INTO business_catalog (id, kind, code, name, status, revision, created_at, updated_at)
SELECT d.id, d.kind, d.code, d.name, 'active', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'
FROM defaults d WHERE NOT EXISTS (SELECT 1 FROM business_catalog c WHERE c.kind = d.kind AND (c.code = d.code OR c.name = d.name));
