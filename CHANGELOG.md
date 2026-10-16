# 变更记录（CHANGELOG）

格式：日期 + 类型 + 条目。**只追加，不改写历史。**当前进度以 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为唯一来源，本文件不承载状态。

## 2026-10-16

### Added
- 建立文档基线，共 9 个文件：README.md、AGENTS.md、docs/FUNCTIONAL_SPEC.md、docs/DEVELOPMENT_PLAN.md、docs/ARCHITECTURE.md、docs/USER_GUIDE.md、docs/PROJECT_STATUS.md、CHANGELOG.md、.gitignore。
- 功能规格：MVP 特性 12 项（F-KB-001~008、F-NAV-001~002、F-OPS-001~002）+ 延期特性 2 项（F-COL-001 实时共同编辑、F-SEC-001 账号与权限），含逐项验收标准与特性—任务覆盖矩阵。
- 开发计划：TASK-001~TASK-010 与延期 TASK-D01/D02，含交付物、依赖（无环）、阶段门槛与 MVP 完成判定。
- 架构基线：模块划分、数据实体、乐观版本与 409 冲突处理、备份恢复、内网访问边界、部署假设与待决策清单。
- 用户指南：明确当前未实现，仅描述预期操作流程，不含任何启动命令。
- 项目状态基线：唯一状态源，任务全部未开始，下一任务 TASK-001。
- .gitignore：排除依赖、构建产物、密钥、环境变量文件、本地数据与日志，保留 env.example。

### Notes
- 本基线只包含文档与 .gitignore：无产品代码、无测试，未执行任何构建、运行或部署。仓库为私有：https://github.com/GuiYe314/team-toolbox。

### Reviewed
- Codex 复核并明确标签 AND 语义、存储层冲突验证阶段、覆盖保存的条件写入、恢复前校验与失败回退；工具空状态仅展示用户所需信息。

### 阶段规划细化
- 将第一版划分为项目基础、界面与工具框架、知识库核心、内容组织与查找、数据保护、交付验收六阶段；账号权限和实时共同编辑列为两个后续阶段。
- 保留任务编号，明确实时协同依赖账号权限；同步状态与功能规格。
- 固化 WorkBuddy 模型与积分报告规则，未提供积分时不得推算。本次未调用 WorkBuddy。

### SQLite 数据库方案
- 根据用户指定确定 SQLite，更新功能规格、架构、开发任务与状态，新增数据库实施约定。
- 明确驱动与迁移选型、连接初始化、事务、关联约束、版本冲突、错误反馈和备份恢复的交付要求；忽略数据库辅助文件。
- 本次仅更新规划，数据库代码尚未实现，未调用 WorkBuddy。
