# 当前组织与作业位置模型（2026-10-31）

- 组织入口使用 `/api/org/nodes`：任意深度父子节点，编码、名称、状态、发薪主体、计价归属分别维护。分类不再决定组织树形结构。
- 组织的作业上下文继续映射已有 factory ID，以兼容人员、班组、借调、工单和授权；节点指定计价归属后可承接作业。
- 节点权限向下覆盖，不扩展至上级或兄弟；修改上级需要总部权限。循环、过期修订、无权修改以及存在启用下级时的停用均由服务端拒绝。
- 作业位置统一使用 work_areas 的 parent_id，旧产线以原 ID 迁入，原 production_lines 保留作为历史引用兼容层。新位置可在任意位置下继续新增，班组上级位置范围覆盖下级。
- 发薪主体和计价地点互不替代；人员的月度发薪仍由确认结果决定。历史工单和核算快照保持不变。
- 人员班组归属（2026-11-04）：同一人员在任何日期只能属于一个班组，成员有效期起止日都含当天，`valid_to` 为空视为长期。
  服务端与数据库（迁移 `017_crew_membership_unique.sql`：索引 + 插入/更新触发器）双重校验跨班组重叠，包含未来关系；批量添加任一失败整批回滚。
  调班先在原班组设置结束日期，再到新班组登记，例如新关系 11-05 生效则旧关系最晚结束于 11-04；借调同理，接收班组关系必须落在借调期内，到期返岗重新登记原班组关系，不自动恢复。
  人员或班组停用不会自动结束成员关系，归属仍以有效期判断。冲突提示仅在调用方具备该班组 `crew.view` 时给出班组名与日期，否则只提示联系对应管理员。
- 主数据页面操作入口（2026-11-04）：组织与主数据各页取消“归档”入口与归档状态选项，已有记录的修改统一从“编辑”进入；“新增下级”等写入操作放进对应编辑抽屉。
  班组成员关系只在班组编辑（基本信息/适用位置/成员关系三页签）中维护，人员编辑只读展示当前、未来与历史关系。既有归档数据和 DELETE 兼容接口保留，不改写历史工单与核算快照。
- 班次与当天安排（2026-11-05）：班次由基地维护名称、起止时间和启停；结束时间早于或等于开始时间即跨天。排班保存班次时间快照，后续配置修改不改写历史。
  正式班组成员关系决定长期归属；当天的临时替班保存在排班参与者快照中，不新增或改写正式成员关系。单人作业组仍按作业组建模。
- 默认派单不通过系统角色：工单类型在基地内配置默认作业组，运行时再结合当天排班和资格确定执行人。具体链路见 `docs/modules/operations.md`。

以下为兼容接口的既有模型说明，新组织维护入口以上述规则为准。

# 组织、人员、借调与授权

## 1. 边界

- 单集团、多生产基地。固定口径为“饲料总部 → 直属各厂 / 生产基地 → 饲料厂 → 生产班 → 人员”。
- 公司是工资与结算主体，基地负责权限聚合，饲料厂是真实作业单元，生产班承接班组排班和交接。
- 工区、产线保留兼容读取和归档能力，已经退出当前工单主流程。
- 行政归属 `homeCompanyId` / `homeBaseId` 与借调接收 `toCompanyId` / `toBaseId` 分开保存。
- 借调计价使用实际作业基地的单价版本；工资归集到月底所在公司。org 层只保存事实，不在这里做计件金额。
- 能力（capability）与数据范围（scope）分开授予。主流程范围为 `group`、`company`、`base`、`factory`；`work_area` 仅保留兼容。

## 2. 接口

所有接口前缀 `/api`，要求 `Authorization: Bearer <token>`，响应统一 `{ data, meta?, requestId }`。

### 读取

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/org/tree` | 当前账号可见的组织树引用数据 |
| GET | `/org/companies` | 公司分页 |
| GET | `/org/bases` | 基地分页，支持 `companyId`、`q`、`status` |
| GET | `/org/factories` | 饲料厂分页，按工厂授权收窄 |
| GET | `/org/work-areas` | 工区分页，支持 `siteId`（基地）、`workAreaId` |
| GET | `/org/production-lines` | 产线分页 |
| GET | `/org/qualifications` | 作业资格分页 |
| GET | `/org/people` | 人员分页，支持 `companyId`、`siteId`、`q` |
| GET | `/org/people/:id` | 人员详情（含资格） |
| GET | `/org/people/:id/crew-relations` | 人员的班组关系（当前/未来/历史，只读，按 `crew.view` 脱敏） |
| GET | `/org/crews` | 班组分页 |
| GET | `/org/crews/:crewId/members?asOf=YYYY-MM-DD` | 指定日期的班组成员 |
| GET | `/org/shift-templates` | 当前账号可见基地的班次模板；工厂授权仍需有本厂可用范围 |
| GET | `/org/secondments` | 借调分页 |
| GET | `/org/access/options` | 授权可选账号、角色、范围（仅总部权限管理员） |
| GET | `/org/access/assignments?accountId=` | 当前授权（仅总部权限管理员） |

分页参数：`page`、`pageSize`（1–200）、`q`、`status`、`sortOrder`。

### 写入

| 资源 | 创建 | 更新 | 归档/取消 |
| --- | --- | --- | --- |
| 公司 | POST `/org/companies` | PUT `/org/companies/:id` | DELETE `?revision=` |
| 基地 | POST `/org/bases` | PUT `/org/bases/:id` | DELETE `?revision=` |
| 饲料厂 | POST `/org/factories` | PUT `/org/factories/:id` | DELETE `?revision=` |
| 工区 | POST `/org/work-areas` | PUT `/org/work-areas/:id` | DELETE `?revision=` |
| 产线 | POST `/org/production-lines` | PUT `/org/production-lines/:id` | DELETE `?revision=` |
| 资格 | POST `/org/qualifications` | PUT `/org/qualifications/:id` | DELETE `?revision=` |
| 人员 | POST `/org/people` | PUT `/org/people/:id` | DELETE `?revision=` |
| 人员资格 | — | PUT `/org/people/:id/qualifications` | 整表替换 |
| 班组 | POST `/org/crews` | PUT `/org/crews/:id` | DELETE `?revision=` |
| 班组成员 | POST `/org/crews/:crewId/members`、`/members/batch`（整批回滚） | PUT `/org/crew-members/:id`、`/end` | 结束有效期 |

人员读取结果附带 `crew`（当前班组、岗位、有效期），`crewId` 查询参数可按班组筛选人员；班组读取结果附带 `leaderPersonIds`、`leaderNames`（可多名单班组长）与 `memberCount`，均由服务端批量派生，不逐行查询。
| 借调 | POST `/org/secondments` | PUT `/org/secondments/:id` | DELETE `?revision=`（取消） |
| 角色授权 | POST `/org/access/assignments` | — | DELETE `/org/access/assignments/:id` |

## 3. 能力与范围

| 能力 | 有效范围 | 说明 |
| --- | --- | --- |
| `org.view` | group / company / base / factory | 读取组织树和结构 |
| `org.manage` | group / company / base / factory | 公司、基地、饲料厂、生产班维护；工厂授权只能维护本厂 |
| `person.view` | group / company / base / factory | 读取人员；工厂授权只读取本厂人员 |
| `person.manage` | group / company / base / factory | 人员及资格维护 |
| `crew.view` | group / company / base / factory | 读取生产班及成员 |
| `crew.manage` | group / company / base / factory | 生产班成员有效期 |
| `qualification.manage` | group | 总部统一资格字典 |
| `secondment.view` | group / company / base | 借调查看 |
| `secondment.manage` | group / company / base | 发起和取消借调，写入范围为接收基地 |
| `access.manage` | group | 角色授权只由总部维护 |

总部 `group.admin` 具有全总部范围能力；`qd.admin` 覆盖直属各厂基地；`dz.admin` 覆盖生产基地；`hz.factory.admin` 仅覆盖菏泽饲料厂。前端隐藏按钮只是体验，越权最终由服务端返回 403。

## 4. 约束与冲突

- 所有更新必须携带 `revision`，过期返回 `409 REVISION_CONFLICT`。
- 基地仍被饲料厂、工区、产线、生产班或借调引用时，归档返回 `409 REFERENCE_CONFLICT`。
- 饲料厂仍被生产班、人员或交接班配置引用时，归档返回 `409 REFERENCE_CONFLICT`。
- 生产班仍有有效成员时不能归档；成员有效期不能重叠。
- 借调来源必须等于人员当前归属；接收基地必须属于接收公司；同人有效借调日期不能重叠。
- 人员资格失效日期不能早于生效日期；资格仍被人员引用时不能归档。
- 授权范围必须真实存在；同账号、同角色、同范围不能重复授权。

## 5. 页面接入

`src/next/features/org/OrgWorkspace.tsx` 导出默认工作台，可传入 `initialSection`：`structure`、`people`、`secondment`、`access`。

```tsx
import OrgWorkspace from '@next/features/org/OrgWorkspace'

org: { title: '组织与作业结构', element: <OrgWorkspace initialSection="structure" /> },
people: { title: '人员与借调', element: <OrgWorkspace initialSection="people" /> },
access: { title: '角色与数据范围', element: <OrgWorkspace initialSection="access" /> },
```

服务端注册：

```ts
import { orgRoutes } from './modules/org/routes'
await app.register(orgRoutes, { prefix: '/api' })
```

## 6. 已知限制

- 人员资格目前是整表替换，没有独立资格记录 revision；人员本身 revision 会随资格替换递增。
- 公司只保留总部根公司 + 发薪公司两级，不做企业间客户租户隔离。
- 组织树用于主数据导航，人员组织图、跨基地看板属于独立看板能力。
- 工厂授权可以读取所属基地的班次模板，但不会自动获得同基地兄弟工厂的维护权或整家公司资产的管理权。
- 借调月结所需“月底所在公司确认”由 execution/payroll 模块承接，org 只保存借调区间。
- 候选执行人员不是 `listPeople` 的结果。工单模块按“目标基地有效班组”与“目标基地有效借调”取并集；指定班组时借调人员需要进入目标班组。
