# 产品收敛与 demo：接续执行计划

更新：2026-11-05。计划已完成。实现、自动化回归、Codex 内置浏览器端到端验收和文档收口均已结束；当前改动仍未提交、未推送。

## 接续位置

- 项目：`C:\Users\Miao\Projects\EastHope\Feed-test-work-order-refactor`。
- 分支：`codex/product-workload-demo`。
- 当前最后提交：`373cc73 chore: configure engineering agent skills`，仅为先前技能配置提交。
- 本轮产品文档和实现仍在本机工作区，**尚未提交或推送**。工作区同时包含此前的业务改动，接续时保留全部既有内容。
- 产品规格：`docs/product-design.md`；术语：`GLOSSARY.md`；决策：`docs/adr/0001`—`0003`。
- 已发布规格任务：https://github.com/wang9283/work-order-refactor/issues/1 。GitHub 中是规格，本轮实现代码仍仅在本地。
- 操作说明：`docs/demo.md`。预定演示端口 3304，目前未启动。

## 已确认业务规则，直接沿用

1. 核心是饲料生产、装卸作业与计件工作量，通用工单补充；实际阶梯计薪在薪酬系统。
2. PC：生产经理月排班、人员工作量调整，开单低频。App：员工作业与工作量确认；组长当天排班、本组分配调整。
3. 月排班提供默认安排，日排班处理当天例外，两端使用同一份数据。
4. 生产、装卸主要由业务系统生成并同步完工；其他工单由员工自建、自主完结。**全部不增加经理逐单验收。**
5. 单人 100%，同项工序或装卸作业多人初始均分，组长可调。分配比例合计 100%，整单总量保持不变。
6. 员工按日查看个人已完成工单，批量确认、逐单反馈。
7. **员工确认后仍可调整分配，无需再次确认，确认状态保留，展示最新分配量。**
8. PC 日常为排班计划／工单管理／工作量管理；低频配置按基础资料、生产／装卸／其他工单、权限审计归属。App 为作业／日程／工作量／我的。
9. 产品决定参与工序，料类影响预计单价；白夜班不增加价格维度。
10. 本轮是真实本地持久化、双端一致的完整 demo；上游事件和薪酬接收采用本地模拟。

## 当前已落地内容

| 部分 | 内容与入口 |
| --- | --- |
| 合同与客户端 | `packages/contracts/src/operations.ts`、`src/next/shared/operations-api.ts` |
| 后端 | 新增 `server/modules/operations/` 的 service、workloads、allocations、self-orders、routes；注册 `/api/operations` |
| 数据结构 | 新增 `023_operations_workload_flow.sql`，未改旧迁移 |
| PC | Shell 三项日常导航，新增 PlanningWorkspace、WorkloadsWorkspace、OtherBusinessWorkspace、GenericPricesPanel；调整工单、业务配置、模板与规则入口 |
| App | 四底栏，新 WorkPage、SchedulePage、WorkloadPage、DynamicForm、components；接入自建完单、日调整、确认反馈与组长分配 |
| 验证和资料 | `scripts/operations-flow-check.mjs`、`scripts/prepare-operations-demo.mjs` |
| 演示工具 | `scripts/start-product-demo.mjs`、`scripts/product-demo-events.mjs`，package 新增 demo／demo:events／demo:receive／check:operations |

这里只表示代码已落地，不能据此宣称整体 demo 已验收。

## 暂停时的验证状态

- 后端代理报告公开 HTTP＋隔离 SQLite 的四段检查通过：排班共读；日调整／工单快照／防重／产量去重；确认／反馈／确认后调量；自主完单与输出。
- App 代理最后一轮 `npm run typecheck` 通过。此前 DynamicForm 两处类型错误已修复；无需继续按旧错误重复修。
- 启动器、事件／接收助手已通过 `node --check`，但**启动器尚未完整执行**。
- **尚未完成**：越权／版本冲突／缺岗等补充检查、既有八套隔离回归、完整构建、真实浏览器端到端验收、最终代码复核。
- PC 尚需核对班次入口名称、工单来源展示和跨页定位；所有页面的实际交互与移动布局仍待浏览器检查。

## 执行顺序

### 1. 恢复现场并确认集成状态

检查分支和 `git status`，阅读本计划与产品规格。确认新文件都还在工作区，再运行 `npm run typecheck`。检查 PC/App 是否完整使用 operations 接口，修复必要的集成问题。

### 2. 补齐关键边界与回归

在 `operations-flow-check.mjs` 现有隔离接口测试上补齐：员工越权、跨组管理、版本冲突、缺岗待分配、多人比例与数量守恒、重复同步、已确认后调整保留确认。核对班次及作业日期处理、排班变更不回写既有工单。

依次运行：

```powershell
npm run check:operations
node scripts/isolated-acceptance.mjs
npm run build
```

operations 检查脚本自带隔离数据库和临时服务，不要再套一层隔离 runner。既有 runner 有 API、定价、业务明细、事件、定时、班组、借调、位置八套。发现失败先定位本轮影响，保留无关改动。

### 3. 启动独立演示环境

执行 `npm run demo`，先核对 3304 是否空闲。默认使用 `data/product-demo/operations-demo.db`，不使用原 `data/feed.db`。重复启动保留演示结果。

身份与生产基地入口见 `docs/demo.md`。免登录改版前此步骤曾使用账号密码；当前版本直接从页面右上角选择演示身份和基地。演示业务日期使用执行当天的北京时间。

### 4. 真实浏览器走完整闭环

按顺序验证并记录实际结果：

1. PC 经理保存月排班。
2. App 组长修改当天安排，PC 刷新看到相同结果。
3. `npm run demo:events` 模拟生产 100 吨、装卸 40 吨；再次执行不重复生成。
4. 检查按排班取人、默认均分，以及生产多岗位个人量和主单产量的区别。
5. 员工按日批量确认，对一张工单反馈。
6. 组长处理反馈并改分配，例如 50/50 改为 70/30；员工看到最新数量，**确认仍保留**。
7. PC 核对输出，执行 `npm run demo:receive`，检查模拟接收文件与最新分配一致。
8. 员工另建其他现场作业，填写说明并自主完单，确认没有经理审核前置步骤。
9. 刷新、切换演示身份、跨端查询，核对持久化；验证普通员工没有本组管理权限，外组数据受到限制。

只记录实际通过的步骤。模拟上游、模拟薪酬接收与真实本地业务数据应清楚区分。

### 5. 文档与复核收口

按最终实现更新 `docs/modules/org.md`、`templates.md`、`execution.md` 中与新主线冲突的描述，区分当前流程和历史兼容接口。补充简洁的实际验收记录；从代码规范和产品规格两方面复核并修复问题。

全部检查完成后再把规格任务标记完成，向用户交付演示地址、账号、操作路径、验证结果及剩余限制。提交或推送仍需用户明确要求。

## 执行约束

- 继续当前重构仓库；Feed Prototype 只是参考资料，不自动修改另一个项目。
- 不重置数据库，不改旧迁移，不恢复上传、强制交接班、经理逐单验收或员工重确认。
- 不执行 reset／clean／stash 来清理当前工作区，不自动提交或推送。
- 当前没有常驻演示服务；接续时重新核对端口，勿停止其他项目进程。

## 可直接使用的续跑指令

> 继续执行 docs/execution-plan.md。业务规则已经确认，保留当前工作区，完成剩余联调、隔离回归、构建和真实浏览器 demo 验收。不要重新访谈，不重置数据，不自动提交或推送。

## 最终执行结果（2026-11-05）

- 完成排班、默认作业组、资格替班、跨天归属、洗消凭证、自主完单、工作量分配、确认、反馈、输出和模拟薪酬接收。
- 修复浏览器验收发现的三处问题：编辑班次请求携带严格模式不允许的字段；跨组合格人员被候选人 UI 错误过滤；非创建者参与者被误标为“本人自建”。
- `roster-dispatch-check`、`sanitation-flow-check`、`check:operations`、既有八套隔离回归和 `npm run build` 全部通过。
- Codex 内置浏览器完成 PC 月排班与班次维护、App 当天替班、车辆／厂区洗消、员工批量确认与反馈、确认后 70／30 调量、确认保留、PC 输出和模拟薪酬接收。
- 车辆 `WO-20261105-7B71FD`、厂区 `WO-20261105-71FD28`、生产 `WO-20261105-8744CA`、装卸 `WO-20261105-5041C3` 均持久化在独立演示库。
- 实际验收记录和限制见 `docs/demo.md`。未实现相机、相册、本地图片上传、视频、真实上游系统和真实薪酬协议。
- 工作区保留全部历史与本轮未提交改动；未自动提交或推送。

## 排班月表补充执行结果（2026-11-05）

- 按已确认设计树把 PC 排班计划收口为「作业组 × 归属日期」整月表：四行固定示例作业组、横向整月、班次／人数／跨天／日调整／空白标记、洗消工单摘要、详情抽屉、批量覆盖预览及低频入口。
- 修复班次字段未触发覆盖预览重算、确认状态在改条件后残留、洗消摘要跨页定位事件早于目标挂载、隔离脚本对本人摘要账号选择不当，以及整月示例后无排班日断言过期等问题。
- 完成 `typecheck`、完整构建、脚本语法检查、四套重点隔离检查、既有八套回归，以及 Codex 内置浏览器 PC/App 真实操作；具体结果和限制见 `docs/demo.md`。
- 补充 ADR 0005、术语「班组月表」、`docs/product-design.md`、`docs/modules/operations.md` 和 `docs/demo.md`；Issue #1 保留 OPEN 与 `ready-for-agent`，代码仍不提交或推送。

## 外部同步边界补充（2026-11-06）

- 公开 `POST /api/tickets` 只创建其他工单；PC 手工开单抽屉移除“工单类别”和生产、装卸字段，生产、装卸继续由演示同步、触发规则或后续真实上游通过内部仓储逻辑创建。
- 生产、装卸工单禁用开始、填报、提交、审核和取消接口，列表不显示取消按钮；详情仅保留同步状态、只读业务字段、人员／贡献比例和灰色岗位演示字段。
- `business-work-items-check` 改为通过内部创建夹具验证业务字段、比例、价格和触发，并显式断言人工流转被拒绝。
- `npm run typecheck`、`npm run check:operations`、`sanitation-flow-check`、八套隔离回归和 `npm run build` 通过；PC 浏览器复核手工开单与生产详情均符合上述边界。

## 双轴复核修复（2026-11-06）

- 恢复 `001_initial.sql` 的历史内容，新增 `002a_factory_compatibility` 兼容迁移，在旧库升级到工厂模型前补建 `factories` 并修正班组/角色约束；未在旧迁移上继续叠加当前结构。
- 调整人员改为替换当前作业项人员，清理不再参与该工单的旧 `ticket_assignments`，避免已移除人员继续读取、确认或出现在输出中。
- 生产同步按产品参与工序保留全部岗位，包括已排班岗位；未排班岗位进入待分配，不再因只传缺口岗位而丢失明细。
- 洗消当天人员存在资格不符时整单进入待分配，不保存部分合格人员；手工开单服务端和 PC 类型选择均排除洗消。
- 生产、装卸岗位价格只读；PC 历史月份和空白历史日期不可编辑，服务端同时拒绝历史 `workDate` 写入。
- 修复 `legacy-upgrade-check` 的最新迁移断言。
- `npm run typecheck`、`npm run check:operations`、`sanitation-flow-check`、`roster-dispatch-check`、`legacy-upgrade-check`、八套隔离回归和 `npm run build` 通过。浏览器复核确认：手工开单无洗消类型，生产详情无价格/执行操作，历史月份批量安排禁用且无空白日新增入口。
