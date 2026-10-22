# 组织、人员、借调与授权

## 1. 边界

- 单集团、多生产基地。公司是工资主体，基地/工区/产线承接实际作业。
- 行政归属 `homeCompanyId` / `homeBaseId` 与借调接收 `toCompanyId` / `toBaseId` 分开保存。
- 借调计价使用实际作业基地的单价版本；工资归集到月底所在公司。org 层只保存事实，不在这里做计件金额。
- 能力（capability）与数据范围（scope）分开授予。范围类型：`group`、`company`、`base`、`work_area`。

## 2. 接口

所有接口前缀 `/api`，要求 `Authorization: Bearer <token>`，响应统一 `{ data, meta?, requestId }`。

### 读取

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/org/tree` | 当前账号可见的组织树引用数据 |
| GET | `/org/companies` | 公司分页 |
| GET | `/org/bases` | 基地分页，支持 `companyId`、`q`、`status` |
| GET | `/org/work-areas` | 工区分页，支持 `siteId`（基地）、`workAreaId` |
| GET | `/org/production-lines` | 产线分页 |
| GET | `/org/qualifications` | 作业资格分页 |
| GET | `/org/people` | 人员分页，支持 `companyId`、`siteId`、`q` |
| GET | `/org/people/:id` | 人员详情（含资格） |
| GET | `/org/crews` | 班组分页 |
| GET | `/org/crews/:crewId/members?asOf=YYYY-MM-DD` | 指定日期的班组成员 |
| GET | `/org/secondments` | 借调分页 |
| GET | `/org/access/options` | 授权可选账号、角色、范围（仅集团管理员） |
| GET | `/org/access/assignments?accountId=` | 当前授权（仅集团管理员） |

分页参数：`page`、`pageSize`（1–200）、`q`、`status`、`sortOrder`。

### 写入

| 资源 | 创建 | 更新 | 归档/取消 |
| --- | --- | --- | --- |
| 公司 | POST `/org/companies` | PUT `/org/companies/:id` | DELETE `?revision=` |
| 基地 | POST `/org/bases` | PUT `/org/bases/:id` | DELETE `?revision=` |
| 工区 | POST `/org/work-areas` | PUT `/org/work-areas/:id` | DELETE `?revision=` |
| 产线 | POST `/org/production-lines` | PUT `/org/production-lines/:id` | DELETE `?revision=` |
| 资格 | POST `/org/qualifications` | PUT `/org/qualifications/:id` | DELETE `?revision=` |
| 人员 | POST `/org/people` | PUT `/org/people/:id` | DELETE `?revision=` |
| 人员资格 | — | PUT `/org/people/:id/qualifications` | 整表替换 |
| 班组 | POST `/org/crews` | PUT `/org/crews/:id` | DELETE `?revision=` |
| 班组成员 | POST `/org/crews/:crewId/members` | PUT `/org/crew-members/:id/end` | 结束有效期 |
| 借调 | POST `/org/secondments` | PUT `/org/secondments/:id` | DELETE `?revision=`（取消） |
| 角色授权 | POST `/org/access/assignments` | — | DELETE `/org/access/assignments/:id` |

## 3. 能力与范围

| 能力 | 有效范围 | 说明 |
| --- | --- | --- |
| `org.view` | group / company / base / work_area | 读取组织树和结构 |
| `org.manage` | group / company / base | 公司、基地、工区、产线、班组维护 |
| `person.view` | group / company / base / work_area | 读取人员 |
| `person.manage` | group / company / base / work_area | 人员及资格维护 |
| `crew.view` | group / company / base / work_area | 读取班组及成员 |
| `crew.manage` | group / company / base / work_area | 班组成员有效期 |
| `qualification.manage` | group | 集团统一资格字典 |
| `secondment.view` | group / company / base | 借调查看 |
| `secondment.manage` | group / company / base | 发起和取消借调，写入范围为接收基地 |
| `access.manage` | group | 角色授权只由总部维护 |

总部 `group.admin` 具有集团范围能力；`qd.admin`、`dz.admin` 的 `base_admin` 授权只覆盖各自基地。前端隐藏按钮只是体验，越权最终由服务端返回 403。

## 4. 约束与冲突

- 所有更新必须携带 `revision`，过期返回 `409 REVISION_CONFLICT`。
- 基地仍被工区、产线、班组或借调引用时，归档返回 `409 REFERENCE_CONFLICT`。
- 班组仍有有效成员时不能归档；成员有效期不能重叠。
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
- 公司只支持集团根公司 + 子公司两级，不做企业间租户隔离。
- 组织树用于主数据导航，人员组织图、跨基地看板属于独立看板能力。
- 借调月结所需“月底所在公司确认”由 execution/payroll 模块承接，org 只保存借调区间。
