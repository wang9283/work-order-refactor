# Issue tracker: GitHub

任务与规格保存在 https://github.com/wang9283/work-order-refactor 的 GitHub Issues，使用 `gh` CLI 操作。

## 仓库与连接

在本仓库目录执行命令。每次会话首次创建 issue 前，用 `gh repo view --json nameWithOwner` 核对目标为 `wang9283/work-order-refactor`；目标不一致时先解决仓库归属。

CLI 不在当前终端 PATH 时，可通过 PowerShell 调用：
`& "$env:LOCALAPPDATA\Programs\GitHub CLI\bin\gh.exe" <参数>`。

Windows 浏览器连接正常、CLI 却出现 TLS 超时时，可在当前 PowerShell 进程使用系统代理：

```powershell
$targetUri = [uri]'https://github.com'
$systemProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($targetUri)
if ($systemProxy.AbsoluteUri -ne $targetUri.AbsoluteUri) {
    $env:HTTPS_PROXY = $systemProxy.AbsoluteUri
}
```

## 常用操作

- 创建：`gh issue create --title "..." --body-file <正文文件>`。
- 读取：`gh issue view <编号> --json number,title,body,labels,comments,assignees,state`。
- 列出：`gh issue list --state open --json number,title,body,labels,comments,assignees`，按需增加 `--label` 或调整 `--state`。
- 修改正文：`gh issue edit <编号> --body-file <正文文件>`。
- 评论：`gh issue comment <编号> --body-file <正文文件>`。
- 标签：`gh issue edit <编号> --add-label "..."` 或 `--remove-label "..."`。
- 关闭：先评论说明结果，再执行 `gh issue close <编号>`；已关闭任务也单独发表评论。
- 多行正文写入临时文件，保留真实换行，再通过 `--body-file` 传入。

## 父子任务与依赖

- 创建子任务：`gh issue create --parent <父任务编号> ...`。
- 关联现有子任务：`gh issue edit <父任务编号> --add-sub-issue <子任务编号>`。
- 增加阻塞关系：`gh issue edit <被阻塞任务编号> --add-blocked-by <阻塞任务编号>`。
- 查看未关闭的阻塞项数量：
  `gh api repos/wang9283/work-order-refactor/issues/<编号> --jq .issue_dependencies_summary.blocked_by`。
- 旧版 CLI 可通过 GitHub API 操作父子关系与依赖；API 要求的数据库 ID 从 issue API 的 `.id` 读取。
- 平台不支持父子关系时，在子任务正文顶部写 `Part of #<父任务编号>`，并在父任务维护任务列表。
- 平台不支持依赖时，在正文顶部写 `Blocked by: #<编号>, #<编号>`。全部阻塞任务关闭后才可开始。

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub 的 issue 与 PR 共用编号；编号类型不明时，先用 `gh pr view <编号>` 判断，再按对应类型操作。

## 技能用语

- “publish to the issue tracker”：创建 GitHub issue。
- “fetch the relevant ticket”：读取对应 GitHub issue。

## Wayfinding operations

- Map：一条带 `wayfinder:map` 标签的 issue，正文维护 Notes、Decisions-so-far、Fog。
- Child ticket：关联到 Map 的子任务，按类型使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。
- Frontier：按 Map 顺序选择首个未关闭、没有未关闭阻塞项且没有负责人的子任务。
- Claim：开始工作前执行 `gh issue edit <编号> --add-assignee @me`。
- Resolve：评论结论、关闭任务，再将结论摘要与链接写入 Map 的 Decisions-so-far。
