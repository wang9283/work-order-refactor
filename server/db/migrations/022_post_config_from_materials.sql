-- 工序/岗位不再按基地启用：岗位范围由物料档案的参与工序决定。
-- 清理基地业务配置中的 production_post 残留，仅保留料类与装卸类型。
DELETE FROM site_business_config_items
WHERE catalog_id IN (SELECT id FROM business_catalog WHERE kind = 'production_post');

UPDATE site_business_config_meta SET revision = revision + 1
WHERE site_id IN (SELECT DISTINCT site_id FROM site_business_config_items);
