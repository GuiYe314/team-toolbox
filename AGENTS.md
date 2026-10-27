# AGENTS.md — 协作代理规则

本文件约束在本仓库工作的 AI 代理与人协作者。规则高于个人默认习惯；文档与代码冲突时，先更新文档再改代码。

## 通用规则

1. **语言**：文档、任务描述、提交说明使用中文；特性编号 `F-xx-xxx` 与任务编号 `TASK-xxx` 一经发布保持稳定，不得重编号或复用已删除编号。
2. **先读后写**：动手前先读 [README](README.md)、[docs/FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)、[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)。
3. **状态唯一来源**：进度与完成情况只记录在 docs/PROJECT_STATUS.md；README 等其他文档只链接引用，不得复制进度，避免双源漂移。
4. **每完成一个 TASK-xxx**：必须同步更新 PROJECT_STATUS.md（完成/未开始、验证证据、下一任务），并在 [CHANGELOG.md](CHANGELOG.md) 追加条目。
5. **禁止把计划当实现**：未经对应验证的代码不得描述为“已完成/已实现/已通过测试”；禁止虚构运行、测试、部署成功。
6. **不虚构命令与结果**：写入文档的命令必须是实际验证过的；尚未存在的功能不得给出使用说明或启动命令。
7. **验证证据**：更新状态时写明证据（命令输出摘要、检查步骤等）；无法验证的明确写“未验证”。
8. **范围纪律**：MVP 完成门槛只包含 DEVELOPMENT_PLAN 中 TASK-001~TASK-010；延期特性（F-COL-001 实时共同编辑、F-SEC-001 账号与权限，对应 TASK-D01/D02）不得计入 MVP 完成。
9. **安全边界**：任何文档或代码中不得宣称系统可无认证安全用于公网；部署假设始终是受控内网/本机。
10. **数据边界**：禁止把浏览器 localStorage 当作团队共享数据库；团队数据一律服务端持久化。

11. **WorkBuddy 调用报告**：每次模型任务结束，报告实际使用模型、执行结果与消耗积分。积分未返回时写“积分未提供，无法确认”；不能用 Token 或美元费用当作积分，不把管理查询重复算作模型请求。

## 前端约定

本项目前端为 Vue 3 + Vite。以下为硬约束，违反即为缺陷，不是风格偏好。

1. **浮层必须 Teleport 到 body**：任何 `position: fixed` 的浮层（弹窗、下拉菜单、浮层提示）必须用 `<Teleport to="body">` 挂到 body 下。原因是 `.glass-panel` 上的 `backdrop-filter` 会创建包含块，使后代 fixed 改为相对该容器而非视口定位（详见 [styles/glass.css](frontend/src/styles/glass.css) 顶部说明）。验收见 `frontend/verify-overlay-position.mjs`。
2. **颜色一律走 CSS 变量**：组件内禁止硬编码色值（含 rgba/hex）。主题差异只在 `theme.css` 声明，量值（字号/圆角/间距/动效时长）只在 `tokens.css` 声明；样式文件按 `tokens → theme → glass → layout → components → 业务样式` 单向依赖，后一层只许引用前一层变量。
3. **深色背景不用纯黑**：大面积底色用 `#090f18` 一类深蓝灰，保证玻璃高光与模糊有可感知层次。
4. **动效时长**：微交互 120~180ms，主题切换 200~300ms；禁止弹跳、大幅缩放、强发光。
5. **图标统一 Lucide 风格**：内联 SVG，`stroke-width` 1.7~1.9；禁止 Emoji 图标、3D 图标、混用多套图标库。
6. **backdrop-filter 不层层嵌套**：只允许大型容器（`.glass-panel` / `.overlay` / `.dialog`）使用；列表项、按钮、输入框一律用半透明背景色。
7. **响应式逐级折叠**，不整体缩放页面；`.app-layout` 保持 `min-width: 1280px`（窄屏横向滚动而非缩放）。
8. **浮层定位先测量后落位**：菜单类浮层应先渲染、测量真实尺寸再夹取到视口内，不硬编码宽度；菜单用 `ref` 取元素而非 `querySelector`（同类浮层会取错）。
9. **破坏性操作需二次确认**：永久删除、清空回收站等不可逆操作必须经用户显式确认（`?confirm=1` 或前端确认弹窗），且失败原因要写进操作日志，不得静默吞掉。
10. **验收脚本自造数据必须按特征全量回收**：清理时按名称特征（如 `/^AM\d{4,}/`）搜索并删除，**不得只硬编码本轮的 id** —— 脚本被中断时 exit 处理器里的异步请求不会跑完，只删本轮 id 会留下垃圾数据污染演示库。
11. **清理文档必须「软删 + 永久删除」两步**：文档删除是软删（TASK-016 回收站），只调 `DELETE /documents/:id` 会把测试数据留在回收站里 —— 跑几次回归就堆一批垃圾。统一用 `frontend/verify-cleanup.mjs` 的 `purgeTestDocuments(apiBase, /标题特征/)` 或 `purgeDocument(apiBase, id)`，它内部完成两步。新增会造文档的验收脚本必须走这个模块。

### 验收脚本索引

前端 `frontend/verify-*.mjs`（真实浏览器 + CDP 自动化），改动对应功能后必须重跑：

| 脚本 | 覆盖 | 对应约定 |
|---|---|---|
| `verify-overlay-position.mjs` | 浮层定位、遮罩铺满视口、弹窗居中 | 1、8 |
| `verify-full-backup.mjs` | 全量备份：菜单明示范围、包结构完整、非法包被拒 | 9 |
| `verify-search.mjs` | 全文检索：中文子串命中、英文词边界、空状态、清除恢复 | 10 |
| `verify-release-runtime.mjs` | 发布包运行时：内置 Node、ABI 自检、启动脚本契约 | — |
| `verify-asset-reference.mjs` | 文档引用资源：插入、落库、渲染、失效降级 | — |
| `verify-document-trash.mjs` | 文档回收站：软删、恢复、永久删除、二次确认、不误伤正常文档 | 9、10 |
| `verify-asset-collections.mjs` | 资源集合：列表、详情、移除不删资源、删集合不删资源 | 9、10 |
| `verify-qr-share.mjs` | 二维码内容、颜色走 CSS 变量、主题切换 | 2、4 |
| `verify-batch-mode.mjs` | 批量模式开关、菜单落在视口内 | 1、8 |
| `verify-asset-preview.mjs` | 预览管线、缩略图、失败原因可见 | — |
| `verify-assets.mjs` | 资源列表、筛选排序、版本历史 | 9、10 |
| `verify-asset-storage.mjs` | 存储路径、导入导出 | — |
| `verify-vditor.mjs` / `verify-help.mjs` / `verify-hint.mjs` | 编辑器、帮助、悬停提示 | 4 |
| `verify-cards.mjs` | 文档卡片布局、响应式降列 | 7 |
| `ui-verify.mjs` | 既有页面通用断言 | 3、5 |
| `verify-batch-delete.mjs` | 知识库批量删除 | 9 |


## 变更流程

- 修改规格：同步更新 FUNCTIONAL_SPEC 的特性条目与覆盖矩阵，保持特性与任务双向覆盖。
- 修改计划：保持依赖无环、阶段门槛可测；新增任务使用新的 TASK-xxx 编号。
- 修改架构：更新待决策清单，标记决策日期与结论；选型不依赖“最新版本”事实。

## 禁止事项

- 未经用户明确授权执行 git push 等远端操作或发布。
- 在 USER_GUIDE 中添加未经验证的启动命令。
- 删除或改写 CHANGELOG 历史条目（只允许追加）。
- 在空状态或指南中展示伪造的运行结果、模拟成功数据。
