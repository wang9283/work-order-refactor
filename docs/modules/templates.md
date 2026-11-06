# 当前表单与工单类型规则（2026-11-06）

- 2026-11-06 起，工单类型按“类型分组 → 工单类型”两层维护。默认分组为生产、装卸、洗消、仓储、司炉、化验、其他；工序、料类、产品、装卸方式、实体产线和车牌号是业务字段，不进入类型目录。
- PC 类型配置与工单列表共用 `GET /api/ticket-catalog` 返回的完整目录。活动分组即使暂无类型、已发布类型即使暂无工单也必须出现在目录中；历史停用类型保留在目录内供查询，草稿类型不出现在工单列表筛选中。
- 生产、装卸为系统内置类型，由外部业务系统同步业务字段、数量和状态；平台不手动新增或执行这两类工单，配置中的内置行只读展示。车辆洗消和厂区洗消归入洗消分组，继续使用各自专用执行流程。
- 配置页“标准来源”用于区分总部标准和公司本地；工单列表“工单来源”用于区分业务同步、员工自建和手工/历史，两个概念不混用。
- 表单在线编辑字段、必填、选项与明细表，支持填写预览、草稿保存和版本发布；复制既有表单可减少配置。
- 当前禁止文件上传：Excel 预览上传接口在读取请求体前拒绝。导航与表单页不展示 Excel 导入入口；照片、附件字段不可新建或发布。
- 历史工单中的媒体字段只读，填报不再要求补充媒体，服务端拒绝修改原文件字段。历史快照不改写；新工单的有效表单不含媒体字段。
- 当前不提供交接班入口，创建工单类型无须配置 work profiles，创建工单无须选择 handover profile。可直接选择组织、位置、班组、可选班次及参与人员。
- 生产和装卸使用服务端内置工单类型、表单版本和业务字段；内置项在普通表单/工单类型列表隐藏。生产配置仅维护基地适用物料类别（工序/岗位由物料档案参与工序决定），装卸配置维护基地适用装卸类型；价格在计价标准统一维护，自动生成方式在生成规则统一维护，基础选项由作业字典提供。
- 通用工单继续使用可发布表单模板；普通模板编辑器不维护料类、生产岗位、装卸类型或生产贡献比例。
- 工单类型在基地内可配置一个默认承接作业组，用于结合当天排班确定执行人；这是业务派单配置，不创建或替换系统岗位角色。车辆洗消、厂区洗消复用现有表单与工单类型，不新增同义岗位。
- 已发布表单不可修改，后续修改通过新草稿版本完成。

以下为保留接口和历史结构说明，涉及 Excel、交接班的段落仅解释兼容实现，不代表当前可用功能。

# 表单版本、工单类型、交接班配置与 Excel 导入

## 1. 核心规则

- 表单模板按“归属 + 编码”唯一；归属为 `group` 或 `company`。
- 表单版本状态：`draft` → `published` → `retired`。
- 已发布版本不可修改、不可删除；修改必须从已发布版本复制出新的草稿版本。
- 饲料总部标准工单类型（`origin=group_standard`）发布后下属单位整份只读；基地或公司可创建自己的本地类型（`origin=local`）。
- 工单类型只能绑定**已发布**的表单版本。
- Excel 导入只生成草稿表单，不直接发布。

## 2. 接口

前缀 `/api`，全部要求登录。

### 表单

| 方法 | 路径 | 能力 |
| --- | --- | --- |
| GET | `/forms?ownerType=&ownerId=&status=&q=&page=&pageSize=` | `form.view` |
| GET | `/forms/:id` | `form.view` |
| POST | `/forms` | `form.manage` |
| POST | `/forms/:id/copies` | `form.manage`，复制为本地表单 |
| POST | `/forms/:id/versions` | `form.manage` |
| PUT | `/forms/:id/versions/:versionId` | `form.manage`，仅草稿 |
| DELETE | `/forms/:id/versions/:versionId` | `form.manage`，仅草稿且非最后一版 |
| POST | `/forms/:id/versions/:versionId/publish` | `form.publish` |

### 工单触发规则

| 方法 | 路径 | 能力 |
| --- | --- | --- |
| GET | `/trigger-rules` | `ticket.view`（按规则基地过滤） |
| POST | `/trigger-rules` | `ticket.create`（限所选基地） |
| PUT | `/trigger-rules/:id` | `ticket.create`，携带 `revision` |
| GET | `/trigger-rules/:id/runs` | `ticket.view` |
| POST | `/trigger-events` | `ticket.create`，演示事件入口 |
| POST | `/trigger-runs/:id/retry` | `ticket.create`，补发漏触发或失败的时段 |

### 工单类型与分类

| 方法 | 路径 | 能力 |
| --- | --- | --- |
| GET | `/ticket-catalog` | 登录后按可见公司读取完整分组、类型和状态目录 |
| GET | `/ticket-types` | `ticket_type.view` |
| GET | `/ticket-types/:id` | `ticket_type.view` |
| POST | `/ticket-categories` | `ticket_type.manage` |
| POST | `/ticket-types` | `ticket_type.manage` |
| POST | `/ticket-types/:id/versions` | `ticket_type.manage` |
| PUT | `/ticket-types/:id/versions/:versionId` | `ticket_type.manage`，仅草稿 |
| POST | `/ticket-types/:id/versions/:versionId/publish` | `ticket_type.manage` |

### Excel

| 方法 | 路径 | 能力 |
| --- | --- | --- |
| POST | `/excel/imports/preview` | `excel_import.manage`，multipart 字段名 `file` |
| POST | `/excel/imports/:importId/commit` | `excel_import.manage` |

预览返回：`importId`、工作表名、列识别结果、最多 20 行样例、提示。提交时传：

```json
{
  "templateName": "交接班记录",
  "templateCode": "EXCEL_SHIFT",
  "ownerType": "company",
  "ownerId": "co_xinjin",
  "mappings": { "班次": "shift", "产量": "output", "作业日期": "workDate" }
}
```

## 3. 权限与归属

- 总部账号：可创建和维护总部标准，也可创建公司本地资产。
- 公司授权、基地授权：可维护本公司或本基地范围内的本地资产；总部标准只读。
- 工厂授权：默认只读取总部和本公司资产，不自动获得整家公司表单与工单类型资产的管理权。
- 列表会按可见公司过滤；后端在写操作前仍做能力与范围校验。
- 总部标准类型的新版本只能由总部发布。
- 总部标准表单与工单类型整份只读。下属单位需要补充字段时，先复制总部表单为本地表单，再创建本地工单类型；原始标准不会被改写。
- Excel 导入跟表单使用同一套归属权限：总部导入归总部，公司本地导入要求公司授权，或该公司下任一基地授权。

## 4. Excel 识别规则

- 支持 `.xlsx`，单文件不超过 12 MB。
- 第一行是字段名称；重复表头直接拒绝。
- 第二行可用 `type:number`、`type:date`、`type:datetime`、`type:single_select`、`type:multi_select`、`type:boolean`、`type:textarea` 显式声明类型。
- 未声明类型时，根据样例推断数字、日期、日期时间；无样例按文本。
- 中文表头生成 `field_1` 形式的内部字段标识；提交映射时可由用户改成合法字段 key。
- 单选/多选选项来自样例值，只作为草稿初值，需人工确认。
- 当前支持主表单字段；子表、条件规则和图片列需在草稿中继续配置。
- Excel 导入任务与上传账号、归属饲料总部/公司绑定；只能提交自己上传且归属一致的任务。

## 5. 交接班式作业配置

`work_profiles` 把工单类型版本绑定到实际作业位置：

- `siteId`：实际作业基地，计价按此基地的价格版本。
- `factoryId`：实际作业饲料厂，工单必须选择。
- `crewId`：生产班，必须属于所选饲料厂。
- `shiftTemplateId`：班次模板。
- `workAreaId` / `productionLineId`：兼容字段，当前工单主流程不用。
- `generationMode`：`manual` / `api` / `schedule`。
- `handoverGrouping`：`none` / `shift` / `day`。
- `handoverRequired`：是否要求交接确认。
- 允许提前/延后时间窗口，以及排班优先、资格优先或人工指派。

没有匹配人员的工单保留“待指派”，系统不猜测。

## 5.1 工单触发规则

其他工单的手工开单始终可用；生产、装卸不提供人工新建入口，只通过外部业务系统同步或内部触发规则生成。触发规则按工单类型维护并版本化；生产/装卸规则冻结业务类别、料类和岗位/装卸类型上下文，创建时复用同一仓储逻辑解析价格快照。

- 规则绑定工单类型、实际作业基地和作业组织，这三项创建后不可修改（要改就新建规则），其余字段可编辑。
- 可选的作业位置、默认班组、生成后完成时限（小时）会写入自动生成的工单；工单按北京时间归属作业日期。
- 两种触发方式：
  - `schedule`：每天或每周指定星期，在指定北京时间生成一张工单；`effectiveFrom`/`effectiveTo` 都含当日。
  - `event`：接收 `POST /api/trigger-events`，按 `eventType` + 条件（`eq`/`in`）匹配，命中即生成。
- 服务端每 30 秒扫描一次，每个规则保存自己的扫描游标（`ticket_trigger_cursors`）和全局心跳（`ticket_trigger_heartbeat`）：
  - 进程停机后重启，游标之后的历史时段一律记为 `missed`（漏触发），不会静默丢弃，也不自动补生成工单。
  - 距离时段 90 秒内的“新鲜”槽位直接执行生成工单；更早的槽位等管理员在“生成记录”里点补发。
  - 心跳用于判定是否有其他进程在跑：没有同行心跳时按历史补齐，避免多进程重复生成。
- `(rule_id, occurrence_key)` 唯一约束保证同一时段只生成一张工单，重复扫描或并发事件不会重复工单；补发使用规则创建人的权限快照，创建人被停用则补发失败并留痕。
- 每次保存规则都递增 `current_version` 并冻结新的 `config_json`，触发记录引用生成当时的版本，事后改规则不会重写历史；补发以规则创建人**当前**的角色与有效期执行，创建人停用或授权过期时补发失败并留痕。
- 生产规则必须选择基地已启用的料类和至少一个生产岗位；装卸规则必须选择基地已启用的一种装卸类型。缺少或停用业务配置时，规则保存或生成明确失败，不推测业务值。
- 事件接口是演示入口，尚未对接真实业务系统；照片/附件与 Excel 上传通道按业务约束关闭（`/excel/imports/preview` 直接返回“当前不允许上传文件”），表单一律在线结构化编辑。

## 6. 页面接入

```tsx
import TemplateWorkspace from '@next/features/templates/TemplateWorkspace'

templates: { title: '表单模板', element: <TemplateWorkspace initialSection="forms" /> },
'ticket-types': { title: '工单类型', element: <TemplateWorkspace initialSection="types" /> },
```

生成规则页支持选择生产、装卸或其他已发布工单类型，并查看生成记录（时间、结果、工单、原因、次数、补发）。工单类型列表提供跳转到对应生成规则的快捷入口。
交接班式作业配置与 Excel 转表单的组件仍在仓库内，但已从“工单标准”页签移除，当前不作为业务入口。

验收（每个套件使用独立种子库，互不干扰，也不会碰到 `data/feed.db`）：

```powershell
node scripts/isolated-acceptance.mjs            # api / pricing / event / schedule 四套
node scripts/isolated-acceptance.mjs --suite pricing,schedule --keep
```

服务端注册：

```ts
import { templateRoutes } from './modules/templates/routes'
await app.register(templateRoutes, { prefix: '/api' })
```

## 7. 已知限制

- 首版表单结构通过 JSON 编辑；可视化拖拽设计器尚未实现。
- 事件触发只对接演示接口，真实业务系统（到货、过磅等）尚未接入。
- 定时触发依赖服务进程存活：进程未运行时不生成工单，重启后按漏触发记录并允许补发，不做“假装没漏”的静默补偿。
- Excel 只读取第一个有数据的 sheet。
- 公式单元格读取缓存结果；没有缓存结果的公式会按文本处理。
- 图片/附件列未从 Excel 自动提取，需在表单草稿中补充。
- 交接班配置页面当前展示类型清单；首版在新增类型抽屉内完成配置，后续可拆成按作业位置维护的配置矩阵。
