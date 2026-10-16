# team-toolbox（团队工具箱）

面向内部小团队的网页版工具集合。第一版（MVP）聚焦知识库：Markdown 文档的新建、编辑、删除、分类、标签、搜索与服务端持久化，首页展示最近更新。工具箱的导航、工具卡片与空状态作为框架保留，**本版不实现任何具体小工具**。

> **使用边界**：第一版仅面向受控的本机/内网环境，未内置认证与权限控制，**不得暴露到公网**。详见 [ARCHITECTURE](docs/ARCHITECTURE.md) 第 7 节“内部访问边界”。

- 仓库：https://github.com/GuiYe314/team-toolbox（私有）
- 文档基线日期：2026-10-16
- 当前状态：仅文档基线，产品代码与测试尚未开始。**进度唯一来源：[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)**（本文件不复制进度）

## 文档导航

| 文档 | 用途 |
|---|---|
| [docs/FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md) | 功能规格（F-xx-xxx 特性编号与验收标准） |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | 开发计划（TASK-xxx 任务、依赖与阶段门槛） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构：模块、数据、冲突处理与待决策清单 |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 用户指南（预期操作流程，当前功能未实现） |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | 项目状态（唯一状态源） |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录（只追加） |
| [AGENTS.md](AGENTS.md) | 协作代理工作规则 |

## 范围速览

- **MVP（v0.1）**：知识库（文档 CRUD、分类、标签、搜索、服务端持久化、首页最近更新）+ 工具导航框架 + 受控内网部署边界 + 备份恢复手段。
- **延期（不计入 MVP 完成门槛）**：实时共同编辑（F-COL-001）、账号与权限（F-SEC-001）。

## 贡献与协作

在本仓库工作前请先阅读 [AGENTS.md](AGENTS.md)；完成任务后必须更新状态文档，禁止把计划描述为已实现。
