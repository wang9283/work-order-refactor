# Domain Docs

本仓库采用 single-context：共用根目录 `GLOSSARY.md`，架构决策存放在 `docs/adr/`。

## 探索代码库前

- 阅读根目录 `GLOSSARY.md`。
- 阅读 `docs/adr/` 中与当前工作相关的 ADR。
- 文件不存在时静默继续；由 domain-modeling 在实际厘清术语或作出决策时创建。

## 使用领域术语

Issue 标题、设计方案、假设和测试名称应使用术语表定义的名称，遵循其中约定的同义词边界。

需要的概念未收录时，先判断是否偏离现有业务用语；确有缺口时交由 domain-modeling 补充。

## 处理 ADR 冲突

方案与已有 ADR 冲突时，明确指出 ADR 编号、冲突内容和重新讨论的原因，再推进决策。
