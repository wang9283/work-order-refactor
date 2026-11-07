# 顶栏作业组织与组织管理同步变更计划

日期：2026-11-06。状态：T1–T3 已实现并验收通过（2026-11-07）。上游决策：用户要求顶栏组织与“组织管理”同步，并确认“只允许选择具体作业组织，上级仅用于展开和定位”。

## 1. 目标与已确认规则

- PC/App 顶栏原“生产基地”选择改为“作业组织”选择，数据来源为组织管理维护的组织树（`org_nodes`），与组织管理页面同源。
- 只允许选择具体作业组织：带 `factory_id`（即已设计价归属、可承接作业）的组织节点；纯分组节点（总部、公司、管理分组）仅用于展开和定位，不可选，也不作为下级数据汇总视图。
- 名称、层级、启停实时同步：组织管理改名、新增、停用后，两端选项在下一次加载时更新；当前组织被停用或失权时提示重选并回退到首个可用作业组织。
- 业务数据按组织收窄：班组、排班、工单、工作量、人员候选限定所选组织（工厂）；同一计价基地下的不同组织互不串数据。
- 计价标准、业务配置仍按计价归属（基地）收窄；总部共享档案不因组织切换改写归属。
- 组织选项与身份权限取交集：仅展示当前演示身份授权覆盖的作业组织；切换组织不扩权，不修改人员归属、班组关系或计价归属。
- PC 与 App 各自保存所选组织，共用业务数据与组织主数据；未保存修改与进行中写入的既有切换保护继续生效。

## 2. 已核对的现状差距

1. 会话范围只存基地：`server/db/migrations/025_demo_session_scope.sql` 为 `sessions` 增加 `demo_identity_id`、`selected_base_id`；`server/core/base-scope.ts` 只按基地校验。
2. 可选基地由授权推导：`server/modules/auth/bases.ts` 的 `authorizedDemoBases` 与 `org_nodes` 无关。
3. 组织管理维护 `org_nodes`：`server/modules/org/hierarchy-routes.ts` 与 `src/next/features/org/HierarchyWorkspace.tsx`；设置计价归属的节点自动创建或关联 `factories`。
4. 演示库缺少组织节点：`scripts/prepare-operations-demo.mjs` 只建公司、基地、工厂，`data/product-demo/operations-demo.db` 的 `org_nodes` 为空，演示环境中组织管理页与顶栏没有共同来源；`data/feed.db` 已有迁移 011 生成的 6 个组织节点。
5. 业务查询只按基地过滤：`server/modules/operations/` 与 `server/modules/execution/repository.ts` 以 `withinScopedBase(..., base_id)` 收窄；班组、人员、工单本身带有 `factory_id`，可作为组织维度。

## 3. 变更清单

### T1 服务端组织上下文与演示组织节点

- 新增迁移 `server/db/migrations/026_demo_session_org_node.sql`：`sessions` 增加可空 `selected_org_node_id`，旧会话兼容。
- 新增 `server/modules/auth/orgs.ts`：`authorizedDemoOrgs(auth)` 返回启用且授权覆盖的作业组织（含 `factory_id`）及层级路径；group 授权见全部，company/base/factory 授权按既有 `hasGrant` 语义收敛，factory 授权沿用组织子树向下扩展。
- `server/modules/auth/demo.ts` 的登录、恢复、切换改为组织维度：校验组织节点、写 `selected_org_node_id`，并由节点 `pricing_site_id` 派生 `selected_base_id` 保持既有基地校验兼容；`server/core/base-scope.ts` 增加 `scopedFactoryId`、`withinScopedFactory`。
- 作业查询增加工厂维度：班组、排班、工单、工作量、人员候选按所选组织的工厂收窄；计价与业务配置保持基地维度。
- `scripts/prepare-operations-demo.mjs` 幂等补建组织节点：演示公司为上级节点，A/B 两个作业组织关联既有 `factory_ops_demo`、`factory_ops_demo_b`；不改写用户已改名称。
- 非演示旧会话不受影响：`scopedBaseId` 对无 `demoIdentityId` 的会话仍返回 null。

### T2 双端顶栏组织选择

- `src/next/shared/auth.tsx` 上下文改为 `orgs / activeOrg / switchOrg`，保留 `contextVersion`、未保存与进行中写入保护；存储键按端独立（`...org.v1.admin` / `...org.v1.mobile`）。
- PC `src/next/admin/Shell.tsx` 顶栏选择器改为组织树：按层级展开，仅作业组织可选，显示名称与编码；App `src/next/mobile/App.tsx` 顶栏同步改为短标签选择器，375px 不溢出。
- 组织管理保存后，两端选项与当前名称刷新即更新；当前组织失效时给出明确原因并回退。

### T3 验收脚本、回归与浏览器验收

- 隔离脚本覆盖：权限交集、停用回退、同基地两组织数据隔离、伪造组织节点 ID 返回 403。
- 运行 typecheck、build 与既有隔离回归；浏览器验收覆盖 PC 顶栏与 App 375px 的组织切换、刷新恢复。

## 4. 验收标准

- [x] 顶栏组织选项与组织管理树同源同名；纯分组节点不可选。（浏览器验收：公司节点点击不切换，作业组织叶子可选）
- [x] 组织管理改名后两端顶栏刷新见新名；停用后当前会话提示并回退，不再读取该组织数据。（改名双端同步实测；停用回退与 403 由 `scripts/org-context-check.mjs` 覆盖）
- [x] 同一计价基地下两个作业组织的工单、班组、排班互不串用；伪造他组织资源 ID 返回 403。（`org-context-check` 通过）
- [x] 各演示身份的组织选项等于授权与启用作业组织的交集；切换组织不扩权。（员工 1 个、生产经理 2 个选项；跨授权切换 403）
- [x] PC/App 所选组织独立、刷新分别恢复；未保存修改与进行中写入保护仍生效。（双端独立实测；`switchOrg` 复用 `prepareSwitch`，未保存切换触发确认框）
- [x] 非演示认证与既有隔离回归不受影响；`data/feed.db` 未修改。（typecheck、build、demo-auth-check、check:operations、isolated-acceptance 8/8 通过）

## 5. 执行入口与边界

- 任务按 AGENTS.md 使用 GitHub Issues：父规格加 T1/T2/T3 子任务，阻塞关系 T1→T2→T3。
- 验证接缝复用公开 HTTP 加隔离 SQLite；浏览器验收使用演示库，不触碰 `data/feed.db`。
- 未获明确指示不提交、不推送、不部署；工作区既有改动全部保留。
