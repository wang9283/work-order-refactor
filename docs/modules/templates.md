# 表单版本、工单类型、交接班配置与 Excel 导入

## 1. 核心规则

- 表单模板按“归属 + 编码”唯一；归属为 `group` 或 `company`。
- 表单版本状态：`draft` → `published` → `retired`。
- 已发布版本不可修改、不可删除；修改必须从已发布版本复制出新的草稿版本。
- 集团标准工单类型（`origin=group_standard`）发布后子公司整份只读；子公司可创建自己的本地类型（`origin=local`）。
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
| POST | `/forms/:id/versions` | `form.manage` |
| PUT | `/forms/:id/versions/:versionId` | `form.manage`，仅草稿 |
| DELETE | `/forms/:id/versions/:versionId` | `form.manage`，仅草稿且非最后一版 |
| POST | `/forms/:id/versions/:versionId/publish` | `form.publish` |

### 工单类型与分类

| 方法 | 路径 | 能力 |
| --- | --- | --- |
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
  "ownerId": "co_qd",
  "mappings": { "班次": "shift", "产量": "output", "作业日期": "workDate" }
}
```

## 3. 权限与归属

- 集团账号：可创建和维护集团标准，也可创建公司本地资产。
- 公司账号：只能创建和维护自己公司的本地资产，集团标准只读。
- 列表会按可见公司过滤；后端在写操作前仍做能力与范围校验。
- 集团标准类型的新版本只能由总部发布。

## 4. Excel 识别规则

- 支持 `.xlsx`，单文件不超过 12 MB。
- 第一行是字段名称；重复表头直接拒绝。
- 第二行可用 `type:number`、`type:date`、`type:datetime`、`type:single_select`、`type:multi_select`、`type:boolean`、`type:textarea` 显式声明类型。
- 未声明类型时，根据样例推断数字、日期、日期时间；无样例按文本。
- 中文表头生成 `field_1` 形式的内部字段标识；提交映射时可由用户改成合法字段 key。
- 单选/多选选项来自样例值，只作为草稿初值，需人工确认。
- 当前支持主表单字段；子表、条件规则和图片列需在草稿中继续配置。

## 5. 交接班式作业配置

`work_profiles` 把工单类型版本绑定到实际作业位置：

- `siteId`：实际作业基地，计价按此基地的价格版本。
- `workAreaId` / `productionLineId` / `crewId`：工区、产线、班组。
- `shiftTemplateId`：班次模板。
- `generationMode`：`manual` / `api` / `schedule`。
- `handoverGrouping`：`none` / `shift` / `day`。
- `handoverRequired`：是否要求交接确认。
- 允许提前/延后时间窗口，以及排班优先、资格优先或人工指派。

没有匹配人员的工单保留“待指派”，系统不猜测。

## 6. 页面接入

```tsx
import TemplateWorkspace from '@next/features/templates/TemplateWorkspace'

templates: { title: '表单模板', element: <TemplateWorkspace initialSection="forms" /> },
'ticket-types': { title: '工单类型', element: <TemplateWorkspace initialSection="types" /> },
profiles: { title: '交接班式作业配置', element: <TemplateWorkspace initialSection="profiles" /> },
excel: { title: 'Excel 转表单', element: <TemplateWorkspace initialSection="excel" /> },
```

服务端注册：

```ts
import { templateRoutes } from './modules/templates/routes'
await app.register(templateRoutes, { prefix: '/api' })
```

## 7. 已知限制

- 首版表单结构通过 JSON 编辑；可视化拖拽设计器尚未实现。
- Excel 只读取第一个有数据的 sheet。
- 公式单元格读取缓存结果；没有缓存结果的公式会按文本处理。
- 图片/附件列未从 Excel 自动提取，需在表单草稿中补充。
- 交接班配置页面当前展示类型清单；详细配置在新增类型抽屉内完成。
