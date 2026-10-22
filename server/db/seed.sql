-- Demo data is idempotent: rerunning db:init updates the same fixed IDs.
INSERT OR IGNORE INTO companies
  (id, code, name, short_name, is_group, payroll_enabled, status, revision, created_at, updated_at)
VALUES
  ('group', 'GROUP', '东方希望集团', '集团总部', 1, 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_qd', 'QD', '青岛基地有限公司', '青岛公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('co_dz', 'DZ', '德州基地有限公司', '德州公司', 0, 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO production_bases
  (id, code, name, company_id, address, status, revision, created_at, updated_at)
VALUES
  ('base_qd', 'QD01', '青岛饲料生产基地', 'co_qd', '山东省青岛市', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('base_dz', 'DZ01', '德州饲料生产基地', 'co_dz', '山东省德州市', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO work_areas
  (id, code, name, base_id, parent_id, status, revision, created_at, updated_at)
VALUES
  ('area_qd_prod', 'QD-PROD', '青岛生产工区', 'base_qd', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('area_qd_loading', 'QD-LOAD', '青岛装卸工区', 'base_qd', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('area_dz_prod', 'DZ-PROD', '德州生产工区', 'base_dz', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO production_lines
  (id, code, name, base_id, work_area_id, status, revision, created_at, updated_at)
VALUES
  ('line_qd_1', 'QD-L1', '青岛一号生产线', 'base_qd', 'area_qd_prod', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('line_qd_2', 'QD-L2', '青岛二号生产线', 'base_qd', 'area_qd_prod', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('line_dz_1', 'DZ-L1', '德州一号生产线', 'base_dz', 'area_dz_prod', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO qualifications
  (id, code, name, description, status, revision, created_at, updated_at)
VALUES
  ('qual_prod', 'PROD', '生产操作', '生产设备及产线操作资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('qual_loading', 'LOAD', '装卸作业', '装卸与车辆配合作业资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('qual_wash', 'WASH', '车辆洗消', '车辆洗消及现场记录资格', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO people
  (id, employee_code, name, mobile, home_company_id, home_base_id, status, revision, created_at, updated_at)
VALUES
  ('person_zhang', 'E20114', '张建国', '13800000001', 'co_qd', 'base_qd', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_li', 'E20115', '李树军', '13800000002', 'co_qd', 'base_qd', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_wang', 'E20116', '王海', '13800000003', 'co_qd', 'base_qd', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('person_sun', 'E20118', '孙明', '13800000005', 'co_dz', 'base_dz', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO person_qualifications
  (id, person_id, qualification_id, valid_from, valid_to, certificate_no, revision, created_at, updated_at)
VALUES
  ('pq_zhang_prod', 'person_zhang', 'qual_prod', '2025-01-01', NULL, 'P-001', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_zhang_load', 'person_zhang', 'qual_loading', '2025-01-01', NULL, 'L-001', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_li_prod', 'person_li', 'qual_prod', '2025-01-01', NULL, 'P-002', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_wang_wash', 'person_wang', 'qual_wash', '2025-01-01', NULL, 'W-003', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('pq_sun_prod', 'person_sun', 'qual_prod', '2025-01-01', NULL, 'P-004', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO crews
  (id, code, name, base_id, work_area_id, leader_person_id, status, revision, created_at, updated_at)
VALUES
  ('crew_qd_a', 'QD-A', '青岛生产甲班', 'base_qd', 'area_qd_prod', 'person_zhang', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('crew_qd_b', 'QD-B', '青岛生产乙班', 'base_qd', 'area_qd_prod', 'person_li', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('crew_dz_a', 'DZ-A', '德州生产甲班', 'base_dz', 'area_dz_prod', 'person_sun', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO crew_memberships
  (id, crew_id, person_id, role, valid_from, valid_to, revision, created_at, updated_at)
VALUES
  ('cm_zhang_a', 'crew_qd_a', 'person_zhang', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_wang_a', 'crew_qd_a', 'person_wang', 'operator', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_li_b', 'crew_qd_b', 'person_li', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('cm_sun_a', 'crew_dz_a', 'person_sun', 'leader', '2026-01-01', NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO secondments
  (id, person_id, from_company_id, from_base_id, to_company_id, to_base_id, start_date, end_date, purpose, status, revision, created_at, updated_at)
VALUES
  ('secondment_demo', 'person_sun', 'co_dz', 'base_dz', 'co_qd', 'base_qd', '2026-10-01', '2026-10-31', '青岛生产旺季借调', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO shift_templates
  (id, code, name, base_id, start_time, end_time, cross_day, status, revision, created_at, updated_at)
VALUES
  ('shift_qd_day', 'DAY', '白班', 'base_qd', '08:00', '20:00', 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('shift_qd_night', 'NIGHT', '夜班', 'base_qd', '20:00', '08:00', 1, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('shift_dz_day', 'DAY', '白班', 'base_dz', '08:00', '20:00', 0, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO roles
  (id, code, name, built_in, description, created_at, updated_at)
VALUES
  ('role_group_admin', 'group_admin', '集团管理员', 1, '总部标准与跨基地管理', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
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
  ('role_group_admin', 'ticket_type.manage'), ('role_group_admin', 'work_profile.view'), ('role_group_admin', 'work_profile.manage'),
  ('role_group_admin', 'excel_import.manage'), ('role_group_admin', 'ticket.view'), ('role_group_admin', 'ticket.create'),
  ('role_group_admin', 'ticket.assign'), ('role_group_admin', 'ticket.review'), ('role_group_admin', 'price.view'),
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
  ('role_base_manager', 'ticket.create'), ('role_base_manager', 'ticket.assign'), ('role_base_manager', 'ticket.review'),
  ('role_base_manager', 'audit.view'),
  ('role_payroll', 'dashboard.view'), ('role_payroll', 'org.view'), ('role_payroll', 'person.view'),
  ('role_payroll', 'ticket.view'), ('role_payroll', 'price.view'), ('role_payroll', 'payroll.view'),
  ('role_payroll', 'payroll.close'),
  ('role_executor', 'dashboard.view'), ('role_executor', 'ticket.view'), ('role_executor', 'ticket.execute');

INSERT OR IGNORE INTO accounts
  (id, username, password_hash, display_name, person_id, status, revision, created_at, updated_at)
VALUES
  ('acct_group', 'group.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '总部管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_qd', 'qd.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '青岛基地管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_dz', 'dz.admin', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '德州基地管理员', NULL, 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
  ('acct_executor', 'executor.demo', 'scrypt$0e67f2b9e2ae4880f29eff8f98634631$20ed2d1d8e719352f1d77790cd898625bf7ed66dc272d870442e610cbde17d1ad1b2cd0ec6755e634e25b917a2486e9a00bd26aee7efcf240cbc8c223b2aa551', '张建国', 'person_zhang', 'active', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO role_assignments
  (id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at)
VALUES
  ('ra_group_admin', 'acct_group', 'role_group_admin', 'group', 'group', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_qd_admin', 'acct_qd', 'role_base_admin', 'base', 'base_qd', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_dz_admin', 'acct_dz', 'role_base_admin', 'base', 'base_dz', NULL, NULL, '2026-10-01T00:00:00.000Z'),
  ('ra_executor', 'acct_executor', 'role_executor', 'base', 'base_qd', NULL, NULL, '2026-10-01T00:00:00.000Z');
