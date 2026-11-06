-- Demo data is idempotent: rerunning db:init updates the same fixed IDs.
INSERT OR IGNORE INTO companies
  (id, code, name, short_name, is_group, payroll_enabled, status, revision, created_at, updated_at)
VALUES
  ('group', 'FEED-HQ', '饲料总部', '饲料总部', 1, 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_xinjin', 'XJ', '新津饲料有限公司', '新津公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_heze', 'HZ', '菏泽饲料有限公司', '菏泽公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_jia', 'JIA', '佳市饲料有限公司', '佳市公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_longjiang', 'LJ', '龙江饲料有限公司', '龙江公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO management_groups (id, code, name, status, created_at, updated_at) VALUES
  ('mg_direct', 'DIRECT', '直属各厂', 'active', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('mg_production', 'PROD', '生产基地', 'active', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO production_bases
  (id, code, name, company_id, address, status, revision, created_at, updated_at, site_confirmed)
VALUES
  ('base_direct', 'DIRECT', '新津作业基地', 'co_xinjin', '四川省成都市新津区', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1),
  ('base_production', 'PROD', '菏泽作业基地', 'co_heze', '山东省菏泽市', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1),
  ('base_jia', 'JIA-BASE', '佳市作业基地', 'co_jia', '黑龙江省佳木斯市', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1),
  ('base_longjiang', 'LJ-BASE', '龙江作业基地', 'co_longjiang', '黑龙江省齐齐哈尔市龙江县', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 1);

INSERT OR IGNORE INTO factories
  (id, code, name, company_id, base_id, management_group_id, factory_type, manager_person_id,
   address, sort_order, status, revision, created_at, updated_at)
VALUES
  ('factory_xinjin', 'XJ-MILL', '新津饲料厂', 'co_xinjin', 'base_direct', 'mg_direct', 'direct_mill',
   NULL, '四川省成都市新津区', 10, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('factory_jia', 'JIA-MILL', '佳市饲料厂', 'co_jia', 'base_jia', 'mg_production', 'feed_mill',
   NULL, '黑龙江省佳木斯市', 20, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('factory_heze', 'HZ-MILL', '菏泽饲料厂', 'co_heze', 'base_production', 'mg_production', 'feed_mill',
   NULL, '山东省菏泽市', 30, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('factory_longjiang', 'LJ-MILL', '龙江饲料厂', 'co_longjiang', 'base_longjiang', 'mg_production', 'feed_mill',
   NULL, '黑龙江省齐齐哈尔市龙江县', 40, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO work_areas
  (id, code, name, base_id, factory_id, parent_id, status, revision, created_at, updated_at)
VALUES
  ('area_xinjin_prod', 'XJ-PROD', '新津生产工区', 'base_direct', 'factory_xinjin', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('area_xinjin_pack', 'XJ-PACK', '新津包装工区', 'base_direct', 'factory_xinjin', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('area_heze_prod', 'HZ-PROD', '菏泽生产工区', 'base_production', 'factory_heze', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO production_lines
  (id, code, name, base_id, work_area_id, status, revision, created_at, updated_at)
VALUES
  ('line_xinjin_1', 'XJ-L1', '新津一号生产线', 'base_direct', 'area_xinjin_prod', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('line_xinjin_2', 'XJ-L2', '新津二号生产线', 'base_direct', 'area_xinjin_pack', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('line_heze_1', 'HZ-L1', '菏泽一号生产线', 'base_production', 'area_heze_prod', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO qualifications
  (id, code, name, description, status, revision, created_at, updated_at)
VALUES
  ('qual_prod', 'PROD', '生产操作', '生产设备及产线操作资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('qual_loading', 'LOAD', '装卸作业', '装卸与车辆配合作业资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('qual_wash', 'WASH', '车辆洗消', '车辆洗消及现场记录资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO people
  (id, employee_code, name, mobile, home_company_id, home_base_id, factory_id, status, revision, created_at, updated_at)
VALUES
  ('person_yang', 'E20114', '阳果', '13800000001', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_wang', 'E20115', '王成伟', '13800000002', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_gao', 'E20116', '高良洪', '13800000003', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_zhu', 'E20118', '朱明贵', '13800000005', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_liu', 'E20119', '刘宝', '13800000006', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_zheng', 'E20120', '郑雷', '13800000007', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_sun', 'E30018', '孙明', '13800000008', 'co_heze', 'base_production', 'factory_heze', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_external', 'EXT-DEMO', '外协人员（无账号）', '', 'co_xinjin', 'base_direct', 'factory_xinjin', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO person_qualifications
  (id, person_id, qualification_id, valid_from, valid_to, certificate_no, revision, created_at, updated_at)
VALUES
  ('pq_yang_prod', 'person_yang', 'qual_prod', '2025-01-01', NULL, 'P-001', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_yang_load', 'person_yang', 'qual_loading', '2025-01-01', NULL, 'L-001', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_wang_prod', 'person_wang', 'qual_prod', '2025-01-01', NULL, 'P-002', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_gao_load', 'person_gao', 'qual_loading', '2025-01-01', NULL, 'L-003', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_zhu_prod', 'person_zhu', 'qual_prod', '2025-01-01', NULL, 'P-004', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_liu_prod', 'person_liu', 'qual_prod', '2025-01-01', NULL, 'P-005', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_zheng_prod', 'person_zheng', 'qual_prod', '2025-01-01', NULL, 'P-006', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_sun_prod', 'person_sun', 'qual_prod', '2025-01-01', NULL, 'P-007', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO crews
  (id, code, name, base_id, work_area_id, factory_id, leader_person_id, status, revision, created_at, updated_at)
VALUES
  ('crew_xinjin_sauce', 'XJ-SAUCE', '酱料生产班', 'base_direct', NULL, 'factory_xinjin', 'person_yang', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('crew_xinjin_premix', 'XJ-PREMIX', '预混生产班', 'base_direct', NULL, 'factory_xinjin', 'person_zhu', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('crew_heze_a', 'HZ-A', '菏泽生产甲班', 'base_production', NULL, 'factory_heze', 'person_sun', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO crew_memberships
  (id, crew_id, person_id, role, valid_from, valid_to, revision, created_at, updated_at)
VALUES
  ('cm_yang_sauce', 'crew_xinjin_sauce', 'person_yang', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_wang_sauce', 'crew_xinjin_sauce', 'person_wang', 'operator', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_gao_sauce', 'crew_xinjin_sauce', 'person_gao', 'operator', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_zhu_premix', 'crew_xinjin_premix', 'person_zhu', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_liu_premix', 'crew_xinjin_premix', 'person_liu', 'operator', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_zheng_premix', 'crew_xinjin_premix', 'person_zheng', 'operator', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_sun_heze', 'crew_heze_a', 'person_sun', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO secondments
  (id, person_id, from_company_id, from_base_id, to_company_id, to_base_id, to_factory_id, start_date, end_date, purpose, status, revision, created_at, updated_at)
VALUES
  ('secondment_demo', 'person_sun', 'co_heze', 'base_production', 'co_xinjin', 'base_direct', 'factory_xinjin', '2026-10-01', '2026-10-31', '新津生产旺季借调', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('secondment_expired_demo', 'person_gao', 'co_xinjin', 'base_direct', 'co_heze', 'base_production', 'factory_heze', '2026-09-01', '2026-09-30', '已到期借调示例', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO crew_scopes (id, crew_id, work_area_id, production_line_id) VALUES
  ('scope_sauce_prod', 'crew_xinjin_sauce', 'area_xinjin_prod', NULL),
  ('scope_sauce_pack', 'crew_xinjin_sauce', 'area_xinjin_pack', NULL),
  ('scope_premix_line1', 'crew_xinjin_premix', NULL, 'line_xinjin_1');

INSERT OR IGNORE INTO shift_templates
  (id, code, name, base_id, start_time, end_time, cross_day, status, revision, created_at, updated_at)
VALUES
  ('shift_direct_day', 'DAY', '白班', 'base_direct', '08:00', '20:00', 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('shift_direct_night', 'NIGHT', '夜班', 'base_direct', '20:00', '08:00', 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('shift_production_day', 'DAY', '白班', 'base_production', '08:00', '20:00', 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('shift_production_night', 'NIGHT', '夜班', 'base_production', '20:00', '08:00', 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO handover_shift_profiles
  (id, name, factory_id, shift_template_id, assignment_mode, handover_required,
   early_start_minutes, late_end_minutes, instruction, status, revision,
   created_at, created_by, updated_at, updated_by)
VALUES
  ('handover_xinjin_sauce_day', '酱料生产班 · 白班交接', 'factory_xinjin', 'shift_direct_day',
   'roster_first', 1, 30, 30, '核对上一班设备、物料与安全事项；班组成员到齐后开始。',
   'active', 1, '2026-10-01T00:00:00.000Z', 'acct_group', '2026-10-01T00:00:00.000Z', 'acct_group'),
  ('handover_xinjin_premix_night', '预混生产班 · 夜班交接', 'factory_xinjin', 'shift_direct_night',
   'roster_first', 1, 30, 30, '核对配方批次、预混物料余量和设备状态。',
   'active', 1, '2026-10-01T00:00:00.000Z', 'acct_group', '2026-10-01T00:00:00.000Z', 'acct_group'),
  ('handover_heze_day', '菏泽生产甲班 · 白班交接', 'factory_heze', 'shift_production_day',
   'roster_first', 1, 30, 30, '核对生产计划、质量和设备交接事项。',
   'active', 1, '2026-10-01T00:00:00.000Z', 'acct_group', '2026-10-01T00:00:00.000Z', 'acct_group');

INSERT OR IGNORE INTO handover_shift_profile_crews (profile_id, crew_id)
VALUES
  ('handover_xinjin_sauce_day', 'crew_xinjin_sauce'),
  ('handover_xinjin_premix_night', 'crew_xinjin_premix'),
  ('handover_heze_day', 'crew_heze_a');

INSERT OR IGNORE INTO roles
  (id, code, name, built_in, description, created_at, updated_at)
VALUES
  ('role_group_admin', 'group_admin', '总部权限管理员', 1, '饲料总部标准与跨基地管理', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('role_base_admin', 'base_admin', '基地配置管理员', 1, '基地主数据和工单配置管理', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('role_base_manager', 'base_manager', '基地工单管理员', 1, '工单分派与执行监控', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('role_payroll', 'base_payroll', '基地核算员', 1, '计件核算和月结', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('role_executor', 'executor', '执行人', 1, '移动端填报工单', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO role_capabilities (role_id, capability) VALUES
  ('role_group_admin', 'dashboard.view'), ('role_group_admin', 'org.view'), ('role_group_admin', 'org.manage'),
  ('role_group_admin', 'person.view'), ('role_group_admin', 'person.manage'), ('role_group_admin', 'crew.view'),
  ('role_group_admin', 'crew.manage'), ('role_group_admin', 'qualification.manage'), ('role_group_admin', 'secondment.view'),
  ('role_group_admin', 'secondment.manage'), ('role_group_admin', 'access.manage'), ('role_group_admin', 'form.view'),
  ('role_group_admin', 'form.manage'), ('role_group_admin', 'form.publish'), ('role_group_admin', 'ticket_type.view'),
  ('role_group_admin', 'ticket_type.manage'), ('role_group_admin', 'business_catalog.manage'), ('role_group_admin', 'work_profile.view'), ('role_group_admin', 'work_profile.manage'),
  ('role_group_admin', 'excel_import.manage'), ('role_group_admin', 'ticket.view'), ('role_group_admin', 'ticket.create'),
  ('role_group_admin', 'ticket.assign'), ('role_group_admin', 'ticket.execute'), ('role_group_admin', 'ticket.review'), ('role_group_admin', 'price.view'),
  ('role_group_admin', 'price.manage'), ('role_group_admin', 'payroll.view'), ('role_group_admin', 'payroll.close'),
  ('role_group_admin', 'audit.view'),
  ('role_base_admin', 'dashboard.view'), ('role_base_admin', 'org.view'), ('role_base_admin', 'org.manage'),
  ('role_base_admin', 'person.view'), ('role_base_admin', 'person.manage'), ('role_base_admin', 'crew.view'),
  ('role_base_admin', 'crew.manage'), ('role_base_admin', 'qualification.manage'), ('role_base_admin', 'secondment.view'),
  ('role_base_admin', 'secondment.manage'), ('role_base_admin', 'access.manage'), ('role_base_admin', 'form.view'),
  ('role_base_admin', 'form.manage'), ('role_base_admin', 'form.publish'), ('role_base_admin', 'ticket_type.view'),
  ('role_base_admin', 'ticket_type.manage'), ('role_base_admin', 'work_profile.view'), ('role_base_admin', 'work_profile.manage'),
  ('role_base_admin', 'excel_import.manage'), ('role_base_admin', 'ticket.view'), ('role_base_admin', 'price.view'),
  ('role_base_admin', 'audit.view'),
  ('role_base_manager', 'dashboard.view'), ('role_base_manager', 'org.view'), ('role_base_manager', 'person.view'),
  ('role_base_manager', 'crew.view'), ('role_base_manager', 'secondment.view'), ('role_base_manager', 'form.view'),
  ('role_base_manager', 'ticket_type.view'), ('role_base_manager', 'work_profile.view'), ('role_base_manager', 'ticket.view'),
  ('role_base_manager', 'ticket.create'), ('role_base_manager', 'ticket.assign'),
  ('role_base_manager', 'ticket.execute'), ('role_base_manager', 'ticket.review'),
  ('role_base_manager', 'audit.view'),
  ('role_payroll', 'dashboard.view'), ('role_payroll', 'org.view'), ('role_payroll', 'person.view'),
  ('role_payroll', 'ticket.view'), ('role_payroll', 'price.view'), ('role_payroll', 'payroll.view'),
  ('role_payroll', 'payroll.close'),
  ('role_executor', 'dashboard.view'), ('role_executor', 'ticket.view'), ('role_executor', 'ticket.execute');

INSERT OR IGNORE INTO accounts
  (id, username, password_hash, display_name, person_id, status, revision, created_at, updated_at)
VALUES
  ('acct_group', 'group.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '总部管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_qd', 'qd.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '新津基地管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_dz', 'dz.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '生产基地管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_hz_factory', 'hz.factory.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '菏泽饲料厂管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_qd_manager', 'qd.manager', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '新津工单管理员', 'person_yang', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_qd_payroll', 'qd.payroll', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '新津核算员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_executor', 'executor.demo', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '阳果', 'person_yang', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO role_assignments
  (id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at)
VALUES
  ('ra_group_admin', 'acct_group', 'role_group_admin', 'group', 'group', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_qd_admin', 'acct_qd', 'role_base_admin', 'base', 'base_direct', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_dz_admin', 'acct_dz', 'role_base_admin', 'base', 'base_production', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_hz_factory_admin', 'acct_hz_factory', 'role_base_admin', 'factory', 'factory_heze', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_qd_manager', 'acct_qd_manager', 'role_base_manager', 'base', 'base_direct', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_qd_payroll', 'acct_qd_payroll', 'role_payroll', 'base', 'base_direct', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_executor', 'acct_executor', 'role_executor', 'base', 'base_direct', NULL, NULL, '2026-10-01T00:00:00.000Z');

-- Published demo standard and distinct site prices allow an immediate PC/App walkthrough.
INSERT OR IGNORE INTO ticket_categories (id, code, name, owner_type, owner_id, status, locked, revision, created_at, updated_at)
VALUES ('cat_demo', 'DEMO-PROD', '生产作业示例', 'group', 'group', 'active', 1, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO form_templates (id, code, name, owner_type, owner_id, source, locked, current_published_version_id, revision, created_at, updated_at)
VALUES ('form_demo', 'DEMO-FORM', '生产作业记录', 'group', 'group', 'native', 1, 'formver_demo', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO form_versions (id, template_id, version_no, status, schema_json, published_at, published_by, revision, created_at, updated_at)
VALUES ('formver_demo', 'form_demo', 1, 'published', '{"mainFields":[{"id":"demo_note","key":"note","name":"作业记录","type":"text","required":true,"strategy":"blocking","sort":1,"isCore":true,"editableByLocal":false}],"subForms":[],"conditionRules":[]}', '2026-10-01T00:00:00.000Z', 'acct_group', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO ticket_types (id, code, name, category_id, owner_type, owner_id, origin, status, current_version_id, locked, revision, created_at, updated_at)
VALUES ('type_demo', 'DEMO-PRODUCTION', '生产作业工单示例', 'cat_demo', 'group', 'group', 'group_standard', 'published', 'typever_demo', 1, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO ticket_type_versions (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by, revision, created_at, updated_at)
VALUES ('typever_demo', 'type_demo', 1, 'published', 'formver_demo', '2026-10-01T00:00:00.000Z', 'acct_group', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO form_templates (id, code, name, owner_type, owner_id, source, locked, current_published_version_id, revision, created_at, updated_at, system_managed)
VALUES ('form_builtin_production', 'SYSTEM-PRODUCTION', '系统内置生产工单字段', 'group', 'group', 'native', 1, 'formver_builtin_production', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1);
INSERT OR IGNORE INTO form_versions (id, template_id, version_no, status, schema_json, published_at, published_by, revision, created_at, updated_at)
VALUES ('formver_builtin_production', 'form_builtin_production', 1, 'published', '{"mainFields":[],"subForms":[],"conditionRules":[]}', '2026-11-04T00:00:00.000Z', 'acct_group', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
INSERT OR IGNORE INTO ticket_types (id, code, name, category_id, owner_type, owner_id, origin, status, current_version_id, locked, revision, created_at, updated_at, system_managed, business_kind)
VALUES ('type_builtin_production', 'SYSTEM-PRODUCTION', '生产工单', 'cat_demo', 'group', 'group', 'group_standard', 'published', 'typever_builtin_production', 1, 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1, 'production');
INSERT OR IGNORE INTO ticket_type_versions (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by, revision, created_at, updated_at)
VALUES ('typever_builtin_production', 'type_builtin_production', 1, 'published', 'formver_builtin_production', '2026-11-04T00:00:00.000Z', 'acct_group', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
INSERT OR IGNORE INTO form_templates (id, code, name, owner_type, owner_id, source, locked, current_published_version_id, revision, created_at, updated_at, system_managed)
VALUES ('form_builtin_loading', 'SYSTEM-LOADING', '系统内置装卸工单字段', 'group', 'group', 'native', 1, 'formver_builtin_loading', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1);
INSERT OR IGNORE INTO form_versions (id, template_id, version_no, status, schema_json, published_at, published_by, revision, created_at, updated_at)
VALUES ('formver_builtin_loading', 'form_builtin_loading', 1, 'published', '{"mainFields":[],"subForms":[],"conditionRules":[]}', '2026-11-04T00:00:00.000Z', 'acct_group', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
INSERT OR IGNORE INTO ticket_types (id, code, name, category_id, owner_type, owner_id, origin, status, current_version_id, locked, revision, created_at, updated_at, system_managed, business_kind)
VALUES ('type_builtin_loading', 'SYSTEM-LOADING', '装卸工单', 'cat_demo', 'group', 'group', 'group_standard', 'published', 'typever_builtin_loading', 1, 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1, 'loading');
INSERT OR IGNORE INTO ticket_type_versions (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by, revision, created_at, updated_at)
VALUES ('typever_builtin_loading', 'type_builtin_loading', 1, 'published', 'formver_builtin_loading', '2026-11-04T00:00:00.000Z', 'acct_group', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
INSERT OR IGNORE INTO work_profiles (id, ticket_type_version_id, name, site_id, factory_id, work_area_id, production_line_id, crew_id, shift_template_id, generation_mode, handover_grouping, handover_required, time_window_start, time_window_end, early_start_minutes, late_end_minutes, assignment_mode, status, created_at, updated_at)
VALUES
  ('wp_demo_xj', 'typever_demo', '新津生产作业', 'base_direct', 'factory_xinjin', NULL, NULL, NULL, 'shift_direct_day', 'manual', 'shift', 1, '07:30', '20:30', 30, 30, 'roster_first', 'published', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('wp_demo_hz', 'typever_demo', '菏泽生产作业', 'base_production', 'factory_heze', NULL, NULL, NULL, 'shift_production_day', 'manual', 'shift', 1, '07:30', '20:30', 30, 30, 'roster_first', 'published', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
INSERT OR IGNORE INTO price_rule_versions (id, ticket_type_id, site_id, version_no, unit, unit_price_micros, effective_from, effective_to, status, revision, created_at, updated_at)
VALUES
  ('price_demo_xj', 'type_demo', 'base_direct', 1, '件', 2500000, '2026-01-01T00:00:00.000Z', NULL, 'published', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('price_demo_hz', 'type_demo', 'base_production', 1, '件', 3000000, '2026-01-01T00:00:00.000Z', NULL, 'published', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO tickets (id, ticket_no, ticket_type_id, ticket_type_version_id, form_version_id, site_id, factory_id, work_area_id, production_line_id, crew_id, shift_template_id, handover_shift_profile_id, status, work_date, event_time, values_json, sub_form_values_json, price_rule_version_id, quantity, revision, created_at, updated_at, ticket_type_snapshot_json, form_snapshot_json, site_snapshot_json, price_snapshot_json)
VALUES ('ticket_demo_app', 'WO-DEMO-APP', 'type_demo', 'typever_demo', 'formver_demo', 'base_direct', 'factory_xinjin', 'area_xinjin_prod', 'line_xinjin_1', 'crew_xinjin_sauce', 'shift_direct_day', 'handover_xinjin_sauce_day', 'pending_start', date('now','localtime'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), '{}', '{}', 'price_demo_xj', 2, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  '{"ticketTypeId":"type_demo","name":"生产作业工单示例","typeVersionNo":1,"formVersionNo":1}',
  '{"mainFields":[{"id":"demo_note","key":"note","name":"作业记录","type":"text","required":true,"strategy":"blocking","sort":1,"isCore":true,"editableByLocal":false}],"subForms":[],"conditionRules":[]}',
  '{"siteId":"base_direct","siteName":"新津作业基地","factoryId":"factory_xinjin","factoryName":"新津饲料厂","workAreaId":"area_xinjin_prod","workAreaName":"新津生产工区","productionLineId":"line_xinjin_1","productionLineName":"新津一号生产线","crewId":"crew_xinjin_sauce","crewName":"酱料生产班","shiftTemplateId":"shift_direct_day","shiftName":"白班","handoverShiftProfileId":"handover_xinjin_sauce_day","handoverName":"酱料生产班 · 白班交接"}',
  '{"id":"price_demo_xj","versionNo":1,"unit":"件","unitPriceMicros":2500000,"effectiveFrom":"2026-01-01T00:00:00.000Z","effectiveTo":null}');
INSERT OR IGNORE INTO ticket_assignments (id, ticket_id, person_id, role, assignment_source, planned_quantity, actual_quantity, created_at, updated_at, person_name_snapshot, person_snapshot_json)
VALUES
  ('assign_demo_yang', 'ticket_demo_app', 'person_yang', 'lead', 'roster', 2, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), '阳果', '{"id":"person_yang","name":"阳果","employeeCode":"E20114","homeCompanyId":"co_xinjin","homeBaseId":"base_direct","factoryId":"factory_xinjin","source":"roster"}'),
  ('assign_demo_external', 'ticket_demo_app', 'person_external', 'member', 'manual', 2, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), '外协人员（无账号）', '{"id":"person_external","name":"外协人员（无账号）","employeeCode":"EXT-DEMO","homeCompanyId":"co_xinjin","homeBaseId":"base_direct","factoryId":"factory_xinjin","source":"manual"}');
