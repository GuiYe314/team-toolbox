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

## 全工具局域网访问边界（F-OPS-005 / TASK-035）

- 用户授权全部工具受控局域网访问。Windows 启动器默认 Lan，`/local` 或 `-AccessMode Local` 恢复仅本机；直接 Node/npm 启动仍默认 Local。前后端必须同步监听模式及 `TOOLBOX_ALLOW_LAN`，禁止只开放页面却留下不可用工具接口。
- `tool-access.js` 依据真实 TCP 连接与实际私网网卡掩码判断来源，Host 限服务器地址，工具 API 保留浏览器同源及专用头。不能信任 X-Forwarded-*；Vite 必须在代理前检查真实来源及 WebSocket 升级，保留原始 Host，代理端口跟随 PORT。
- 全部本机路径、ADB、Unity 搜索和 ArtCraft 启动均发生在服务器。FreeLLMAPI 仍只连接服务器回环，远程浏览器不能把其管理页链接解释为自己的 localhost；HTTP 复制须兼容降级，不增加账户/凭据持久化或任意代理。
- 修改网络边界后执行完整后端测试、前端构建、`node scripts/verify-lan-access.mjs` 和启动脚本验收；受影响的安卓/集成浏览器验收使用 `TT_VERIFY_LAN=1`。测试保持临时数据/离线设备；实际服务切换只在用户授权范围内按项目身份重启。网络类别和防火墙不得整体关闭或随意放宽，公网仍不支持。

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
11. **清理测试数据必须扫「正常 + 回收站」两个范围**：文档与资源都是软删，只调 `DELETE` / `batch-delete` 只会把测试数据移进回收站 —— 跑几次回归就堆一批垃圾，而且**一旦沉进回收站就再也匹配不到**（列表默认不含回收站），会永久堆积。统一用 `frontend/verify-cleanup.mjs`：
    - 文档：`purgeTestDocuments(apiBase, /标题特征/)`
    - 资源：`purgeTestAssets(apiBase, /名称特征/)`
    两者内部都完成了「软删 → 永久删除」两步，并同时扫两个范围。新增会造数据的验收脚本必须走这个模块。
12. **验收脚本不得真的执行「安装更新」**：`POST /api/update/apply` 会替换程序文件并重启服务，跑一次测试环境就变样了，还可能把开发目录换成发布包内容。`verify-update.mjs` 只验证到「界面把状态讲清楚」，换文件与回滚由 `backend/src/updater.test.js` 与隔离沙箱里的 `apply.cmd` 手工验证覆盖。测试更新相关功能时，更新源指向 `os.tmpdir()` 下的临时目录，结束务必清空配置（`PUT /api/update/source` 传空串）。

### 验收脚本索引

前端 `frontend/verify-*.mjs`（真实浏览器 + CDP 自动化），改动对应功能后必须重跑：

| 脚本 | 覆盖 | 对应约定 |
|---|---|---|
| `verify-integrations.mjs` | Yoinks 组件/视频分析/下载领取/取消清理，FreeLLMAPI 实际 HTTP 模型与流/多轮/停止/清空/凭据隔离，ArtCraft 提示词/路径/确认启动，主题/1280 布局/Teleport/焦点；临时数据与模拟本机服务 | 1、2、7 |
| `verify-overlay-position.mjs` | 浮层定位、遮罩铺满视口、弹窗居中 | 1、8 |
| `verify-full-backup.mjs` | 全量备份：菜单明示范围、包结构完整、非法包被拒 | 9 |
| `verify-search.mjs` | 全文检索：中文子串命中、英文词边界、空状态、清除恢复 | 10 |
| `verify-release-runtime.mjs` | 发布包运行时：内置 Node、ABI 自检、启动脚本契约 | — |
| `verify-earth-sunlight.mjs` | 地球光照：WebGL/本地贴图、太阳、赤道/回归线与中文标注及遮挡、缩放/旋转/复位、刷新、后台/离页释放、失败降级/重试、加载取消和明暗布局；使用隔离静态服务和空只读列表 | 2、7 |
| `verify-asset-reference.mjs` | 文档引用资源：插入、落库、渲染、失效降级 | — |
| `verify-document-trash.mjs` | 文档回收站：软删、恢复、永久删除、二次确认、不误伤正常文档 | 9、10 |
| `verify-asset-collections.mjs` | 资源集合：列表、详情、移除不删资源、删集合不删资源 | 9、10 |
| `verify-update-isolated.mjs` → `verify-update.mjs` | 自动更新：默认 GitHub、仓库转换、关闭/恢复、已最新/有新版/清单损坏与换源缓存；临时数据、禁止上游访问及安装 | 9、12 |
| `verify-android-wireless.mjs` | 安卓调试：双栏与独立滚动、帮助/ADB 设置弹窗、六项常用命令、当前用户 HOME 选择/确认/复查/恢复/失效清理、自定义命令增改删/持久化/确认/版本冲突、APK 单台/多选/全选/完整确认/一次上传/逐台实时结果/部分失败/失败重选/取消/离页清理、实时 Logcat、单应用选择/状态/子进程隔离/重启跟随、屏幕单次/连续刷新/放大/取消/图片释放、二维码及六位码配对、单设备断开、错误恢复和明暗下拉对比度；使用离线 ADB 执行器 | 1、2、9 |
| `verify-qr-share.mjs` | 二维码内容、颜色走 CSS 变量、主题切换 | 2、4 |
| `verify-batch-mode.mjs` | 批量模式开关、菜单落在视口内 | 1、8 |
| `verify-asset-preview.mjs` | 预览管线、缩略图、失败原因可见 | — |
| `verify-assets.mjs` | 资源列表、筛选排序、版本历史 | 9、10 |
| `verify-asset-storage.mjs` | 存储路径、导入导出 | — |
| `verify-vditor.mjs` / `verify-help.mjs` / `verify-hint.mjs` | 编辑器、帮助、悬停提示 | 4 |
| `verify-cards.mjs` | 文档卡片布局、响应式降列 | 7 |
| `ui-verify.mjs` | 既有页面通用断言 | 3、5 |
| `verify-batch-delete.mjs` | 知识库批量删除 | 9 |


## 更新器网络边界（F-OPS-003 / TASK-036）

- `update-source.js` 规范化仓库地址；无文件配置才启用默认项目 Releases，显式空源继续关闭。源切换不得显示旧源检查结果，忙碌时不可改源。
- `update-http.js` 仅为更新清单和 ZIP 提供请求级代理，环境优先于 Windows 手动 HTTP/HTTPS 代理，不执行 PAC，不改全局 dispatcher、环境或系统设置。重定向逐目标选路，回环始终直连；代理凭据不得回传、记录或持久化。读取注册表的固定进程必须隐藏、禁用 Shell、限制输出并设超时。
- 换文件脚本必须纯 ASCII、无 BOM、CRLF，Unicode 路径经校验后通过环境传递，禁用延迟展开；等待旧进程不得用外部命令管道，重启显式 CMD /c /nopause 并后台运行。真实项目不得用于 apply 验收，成功替换/失败回滚只在新建独立副本使用合成数据验证。
- 保留 TLS 校验、清单 1 MiB 上限、完整响应时限、ZIP 大小限制、流式 SHA256 与失败清理；任何浏览器验收都不得执行真实 apply。改动后运行完整后端测试（含 `update-http.test.js`）、前端构建和 `node frontend/verify-update-isolated.mjs`；真实源只读取清单，真实安装与回滚另行隔离验收。

## 开源工具接入边界（F-EXT-001～003 / TASK-034）

- `/tools/yoinks`、`/tools/freellmapi`、`/tools/artcraft` 共用 `integration-api.js`，通过 `tool-access.js` 按 Local/Lan 模式校验真实来源、服务器 Host 与浏览器同源上下文；写请求要求 JSON 和 `X-Toolbox-Integration: 1`，禁止任意代理、自由进程参数或自动安装器。
- `integration-common.js` 负责独立机器配置 `data/open-source-tools.json`、路径/回环地址验证与进程执行。配置版本 1 仅保存路径和地址，原子保存并拒绝覆盖损坏文件，不进 SQLite/团队备份。进程使用参数数组、隐藏窗口、禁用 Shell、输出/超时限制，取消进程树只按本轮 PID。
- `yoinks.js` 使用 Yoinks 的 yt-dlp 核心方案，不运行 TUI；禁用外部配置、插件搜索和播放列表，不读取浏览器 Cookie。票据只在内存，下载十五分钟、成品 1 GiB、单次下载临时目录 2 GiB、最多三份十分钟结果。只写随机临时目录，复核媒体文件边界/类型/大小，经本机保护接口领取；取消、离页、超时与正常退出清理。进度不得冒充整项完成；未安装明确未就绪，上游许可见 OPEN_SOURCE_INTEGRATIONS。
- `freellmapi.js` 只访问回环 `/v1/models?available=true` 和 `/v1/chat/completions`，不跟随重定向。统一 Key 只存后端内存、不回传/落盘，切换地址清除旧 Key，配置和请求互斥。最多九轮完整历史/48000 字、单条/回答 12000 字；消费文本 SSE，不执行工具调用，必须有结束标记。请求 120 秒/2 MiB，取消/断连/退出中止；停止/失败片段不进入历史，清空阻止迟到回填，不保证供应商费用或停止行为。
- `artcraft.js` 只确认启动已保存、重新验证的 ArtCraft.exe，无自由参数、原生协议或结束进程。只报告启动请求，原生画布在自身窗口，不把网页预览当完整编辑器。提示词只在当前页，不自动注入，不读取其账号、Key 或素材。
- `integrations.css` 引用 tokens/theme，`IntegrationDialog.vue` Teleport 到 body 并处理 Escape/焦点恢复；日志不记录输入、链接、Key 或模型结果。
- 修改后运行 backend 的 `npm test`（含 `integrations.test.js`）、前端 `npm run build` 和根目录 `node frontend/verify-integrations.mjs`。验收用临时文件、离线执行器、模拟回环模型服务和临时浏览器，不访问团队数据库、真实模型账户或已有桌面程序；不得把合成验证描述为真实外站下载/模型推理/原生应用验收。

## 地球光照边界（F-SUN-001）

- 入口 `EarthSunlight.vue` / `/tools/earth-sunlight`。`solar-position.js` 负责 NOAA 太阳位置近似及球面投影；`solar-geometry.js` 约定 Globe.gl 的 +Y 北极、+Z 零经线、+X 东经 90°，负责分界大圆和透视可见性；`solar-globe-3d.js` 负责 Globe.gl / Three.js 及世界空间着色。地表、云层、标记、分界和射线必须共用太阳方向。
- `SolarGlobe.vue` 管理拖动/缩放/键盘、主题、尺寸与异步加载；WebGL/贴图/材质失败时反馈并使用 `SolarGlobeFallback.vue` / `solar-globe.js` 的 Canvas 简化示意，可重试。不得在失败时把空白场景标记为正常三维。
- `solar-sun.js` 的光球和日冕只作视觉示意，共用太阳方向，不引入外部素材或常驻动画，随场景释放几何体/材质。赤道固定为 0°、南北回归线约为 ±23.44°，不随日期或太阳直射纬度移动；三维和 Canvas 降级均保留三线及中文纬度。三维线条和标签须正确遮挡，标签随旋转、缩放与尺寸变化更新，不穿透球体。
- 不添加地图 CDN、外部运行请求、浏览器定位、数据库或 localStorage；时间来自客户端系统时钟。贴图必须本地分发，保留 `frontend/src/assets/earth/README.md` 和页面上的作者/许可/处理署名。云层与灯光为静态示意，不可冒称实时天气或用电；太阳位置为近似，太阳尺寸和射线长度不按比例，背面及地平线外标记不透视显示。
- 每 30 秒在页面可见时刷新，后台暂停、恢复时立即更新；三维库常驻动画与惯性关闭，交互或状态变化才绘制。加载须可取消、20 秒内失败；离页、重试和失败回收定时器、事件、帧、观察器、位图/纹理/材质/几何体、控制器和 WebGL 上下文，迟到结果不得回填。颜色在 theme.css、界面尺度在 tokens.css。
- 修改后执行 frontend 的 `npm test`、`npm run build`，及根目录的 `node frontend/verify-earth-sunlight.mjs`。验收只使用构建产物、临时浏览器和空只读接口，不访问团队数据库。

## 安卓调试边界（F-ADB-001）

- ADB 仅在服务器执行，模块 API 按 F-OPS-005 支持 Local/Lan，检查真实连接来源及服务器 Host；保留浏览器来源检查、JSON 和专用请求头要求，不信任代理转发头。仅 `POST /api/android/apk/install` 与 `POST /api/android/apk/install-batch` 接受带专用头的 `application/octet-stream`，不得放宽其他接口的 JSON 要求。
- 进程调用使用参数数组、禁用本机 Shell、隐藏窗口、输出限制、超时与取消；自定义命令限 TASK-026 的已保存 ID、版本及确认执行，不增加临时自由执行接口或全局断开。
- 六位码配对只使用短期缓存的 mDNS 配对服务；二维码配对只匹配当前短期会话生成的随机服务名。六位码与二维码随机口令仅经 stdin 传给 ADB，禁止写入进程参数、文件或日志。二维码内容仅在会话创建响应中返回当前通过访问校验的页面，状态接口不得回传口令。
- 文件夹扫描必须异步、有深度/目录/条目/结果/时间上限，不跟随子目录链接；多个 ADB 候选由用户选择，校验版本成功后才能保存。兼容既有可执行文件路径和 `ADB_PATH`，不需要 SQLite 或配置结构迁移。
- 扫码会话两分钟有效，可在 ADB 忙碌时取消；取消、到期、配置变化和页面离开后清理口令与二维码。只能自动连接刚配对手机的连接服务；出现同地址多设备歧义时要求手动选择。扫码状态逻辑位于 `android-qr.js`，文件夹搜索位于 `android-adb-search.js`，公共解析位于 `android-adb-protocol.js`。
- ADB 路径持久化到 `data/android-adb.json`（`ADB_PATH` 优先）；自定义命令单独保存到机器配置 `data/android-commands.json`，不放入团队备份。设备、发现服务和配对码均为瞬时状态。
- 断开必须确认明确的单台无线设备，连接和断开后刷新列表，并区分操作失败与操作成功后刷新失败。
- ADB 配置由 `AndroidAdbSettings.vue` 负责，经 `AndroidSettingsDialog.vue` 在调试页与设置页复用；操作说明由 `AndroidHelp.vue` 点击后弹出。弹窗必须 Teleport 到 body，支持键盘关闭与焦点恢复。调试页左侧为设备连接和列表，右侧为命令、APK、屏幕与日志，两栏独立滚动。常用命令位于 `AndroidCommands.vue`，内置仅保留锁定程序、恢复桌面、IP、设备信息、内存与 CPU 六项；接受服务端内置或保存的自定义命令 ID，HOME 命令仅额外接受经过校验的 `component` 与 `userId`，其他命令拒绝这两项及任意附加参数。执行前重新验证目标为 `device`，必须插入 `-s <serial>`。输出不持久化。
- `android-home.js` 通过 `am get-current-user`、限定 HOME Intent 的 `cmd package query-activities/resolve-activity` 读取当前用户、候选与默认值；组件严格校验、规范化并限量。设置必须布尔确认，复核当前用户及实际候选，再执行 `cmd package set-home-activity --user <用户> <组件>`，检查成功输出并复查默认包，失败不能冒称成功。总时限 30 秒，子命令各有输出/超时上限和取消；不猜测普通应用的启动页，不自动启动应用，也不实现禁退锁定。`AndroidHomeSelector.vue` 管理搜索与主动选择，换设备/命令/配置或离页清理；候选、用户与结果只在内存。IP 查询全部接口 IPv4；内存与 CPU 是 dumpsys 快照，不新增后台采集。
- `android-custom-commands.js` 校验单条参数并解析引号，拒绝 `adb` 前缀、全局选项、连接管理和 Shell 管道/重定向/拼接；远端 `shell` 参数须按字面量转义，不能仅依赖本机 `shell:false`。自定义执行总是要求布尔确认和当前版本；修改/删除也核对版本，内置不可修改。命令库原子保存，损坏时拒绝覆盖，原文与结果不记操作日志。编辑弹窗失败保留草稿，不触发执行。
- `android-logcat.js` 只使用固定 `-s <serial> logcat -v threadtime -T 100` 参数读取在线设备。服务端最多保留一个短期会话，缓存最多 2000 条或 1 MiB，单行最多 4096 字符，未完成单行缓冲超过 65536 字符时停止；每次轮询最多 300 条，15 秒无心跳终止进程。日志正文只在内存，不写配置、数据库或操作日志。停止不占用普通命令锁，切换设备、离页、配置变化、对应设备断开/重启及服务器退出必须结束采集；不提供清空手机缓冲区的操作。`AndroidLogcat.vue` 负责过滤、自动滚动和最多 2000 条的页面缓存。
- 安卓原生下拉统一使用 `android.css` 的 `.adb-select`，底色不透明，选项/选中/禁用态按主题配色。主题切换时文字与底色同步更新，避免全局输入框背景动画造成瞬时低对比。
- `android-apk.js` 只允许已确认的单个完整 APK、最多 1 GiB、明确在线授权设备；上传流写系统临时目录随机私有文件夹，不能接受客户端路径或原始 ADB 参数，不得把整个 APK 缓存在内存。校验 ZIP 结构和根 AndroidManifest.xml 后再次验证设备，用固定 `-s <serial> install -r <临时包>` 覆盖并保留数据，不自动卸载、降级、授权或启动应用。与普通命令共用独占锁，上传与安装各五分钟，输出限量，取消/断连/离页/服务退出后回收进程及临时文件。上传百分比不能冒充安装进度；仅明确 Success 且无失败标识才显示成功，取消需说明手机最终状态不能回滚。包名和输出不入操作日志，临时 APK 不入数据库或备份。新增测试在 `android-apk.test.js`，浏览器验收继续使用离线执行器。
- 多设备 APK 安装只接受已确认的 1～20 个不重复序列号；复制目标快照、一次上传并复用同一临时包逐台安装。每台重新检查在线授权、独立五分钟时限；单台失败或超时必须继续其他设备并明确部分失败。批量端点用 NDJSON 返回实时结果与最终汇总，HTTP 流断开、用户取消、离页或服务退出须停止当前及后续队列并清理；已完成安装不回滚。前端必须收到汇总才确认整批结束，异常中断保留已知结果并提示核对；失败重选仅选当前在线失败项且必须重新确认。文件、目标和结果不持久化，保留原单台接口及 JSON 响应。
- `android-apps.js` 只读查询明确在线设备上的包名、安装路径与进程，包名必须严格校验，参数固定为 `pm list packages`、`pm path <包名>`、`ps -A -w -o PID,NAME`，查询有超时和输出上限；使用宽输出避免长包名截断。列表最多 2000 个包名；运行状态按精确包名或 `包名:` 子进程名匹配，不能按任意子串猜测 PID。应用日志只把匹配 PID 的内容加入缓存并返回浏览器；心跳最多每两秒刷新一次 PID 集合，不另起永久扫描定时器，停止时取消在途查询。所有状态只在内存，不自动启动/停止手机应用，不把进程存在等同于前台或健康状态；短暂进程/特殊进程名/系统代写日志的限制必须在帮助中说明。
- `android-screen.js` 只读在线且已授权的明确设备，以固定 `-s <serial> exec-out screencap -p` 参数读取原始二进制，禁止复用 UTF-8 文本 runner。设备检查与截图总时限 12 秒，图片输出最多 16 MiB、错误输出最多 4096 字节，验证 PNG 签名、块边界与 CRC、IHDR/IDAT/IEND、单边 16384 和总像素 32 Mi 上限。全服务最多一个在途截图，不占普通命令锁；请求取消、配置变化、对应设备断开/重启和服务退出时取消。API 复用本机保护，返回不缓存的 PNG；图片不写磁盘、数据库或日志。
- `AndroidScreenPreview.vue` 默认不读取，必须选择设备；连续刷新在上次读取完成后等待所选间隔，不重叠请求。停止保留最后画面，清空会停止并撤销图片 URL；替换、取消解码、切换设备、设备消失、配置变化和卸载时释放 Blob URL。页面进入后台时停止并保留最后画面，离页清空；放大弹窗必须 Teleport 到 body 并支持 Escape 与焦点恢复。帮助须说明截图刷新速度及受保护内容的显示限制。
- 修改后运行 `backend` 的 `npm test`（包含 `android-adb.test.js`、`android-adb-search.test.js`、`android-qr.test.js`、`android-adb-commands.test.js`、`android-home.test.js`、`android-custom-commands.test.js`、`android-apk.test.js`、`android-logcat.test.js`、`android-apps.test.js` 和 `android-screen.test.js`）、前端构建和 `node frontend/verify-android-wireless.mjs`。浏览器验收使用临时配置与离线执行器，结束清理临时目录；不得把模拟验证宣称为真实手机验证。

## Unity 局域网日志边界（F-ULOG-001）

- 入口 `UnityLogs.vue` / `/tools/unity-logs`；`unity-log-client.js` 只请求本机后端。`unity-log-view.js` 解析与筛选整条日志，Vue 插值展示正文；预览限 256 KiB、显示限 1000 条。CSS 延续 tokens/theme 约束。
- `unity-log-discovery.js` 按本机私有 IPv4 掩码生成有界候选，仅探测 TCP 日志端口和固定发现协议；默认 1024 地址、64 并发、25 秒总限，报告实际检查范围。指定 IP 也必须属于本机真实私网网段；不能接收自由 URL 或探测公网。
- `unity-log-http.js` 固定路径、严格文件名校验，不跟随重定向；缓冲与流式读取都必须有完整请求超时、取消和响应大小限制。流建立到消费端之间的错误必须被捕获，避免未处理事件或挂起。
- `unity-logs.js` 只在内存缓存发现结果与短期读取会话，最多八个会话，票据不回传浏览器、不记日志、不落盘；重连核对固定编号及 App ID。`unity-log-api.js` 通过共用网络策略校验 Local/Lan 真实来源、服务器 Host/Origin、JSON 与专用头，不信任转发头。文件只读，下载交给浏览器，不自动写团队数据库或备份。
- 取消、切换设备、离页及服务器关闭必须取消在途请求；连接已建立但响应未交付时回收会话。页面后台暂停读取与连接。失败保留上次成功的预览，不能仍标记为正常读取。
- Unity 改动限定 `Assets/Test/Log`，不得改 AnchorFrame 或原 GameLogic 日志模块；不得手改场景/预制体 YAML。设备新增发现协议位于 AOT，需完整重新打包。真实 Android/iPad 权限、网络和后台恢复需硬件单独验证，不能把本机 C# 协议联调当作真机测试。
- 改动后运行完整 `backend` 的 `npm test`（包含 `unity-log-discovery.test.js`、`unity-logs.test.js`、`unity-log-api.test.js`）及前端构建；用隔离 C# 服务提供合成日志，通过浏览器验证搜索、历史、筛选/复制/下载、错误恢复、取消与离页。不得读写真实团队数据库或将合成日志混入设备数据；验证后关闭临时服务。

## Windows 启动与停止边界（F-OPS-004 / TASK-028）

- 源码和发布启动入口共用 `scripts/start-services.ps1`，服务隐藏运行；仅在本轮进程身份、端口归属和健康检查均通过后返回成功。双击启动的 CMD 成功退出，失败保留提示；不得按公共窗口标题操作其他终端。
- 失败只清理本轮创建且身份仍匹配的进程；已占用端口必须拒绝，不得结束占用者。停止入口保持按项目绝对路径匹配并排除同入口的 Vite build/preview/optimize，不能退化为按端口结束进程。
- `logs/` 与轮换文件不得入库。发布打包须包含共享启动/停止辅助脚本，保留内置 Node 自检与 `TT_SKIP_BROWSER=1`。
- 修改启动流程后，在 Windows 运行 `node scripts/verify-startup.mjs`。验收只使用临时目录、合成服务与随机端口，结束后回收临时服务，不启动或停止真实项目实例。

## 变更流程

- 修改规格：同步更新 FUNCTIONAL_SPEC 的特性条目与覆盖矩阵，保持特性与任务双向覆盖。
- 修改计划：保持依赖无环、阶段门槛可测；新增任务使用新的 TASK-xxx 编号。
- 修改架构：更新待决策清单，标记决策日期与结论；选型不依赖“最新版本”事实。

## 禁止事项

- 未经用户明确授权执行 git push 等远端操作或发布。
- 在 USER_GUIDE 中添加未经验证的启动命令。
- 删除或改写 CHANGELOG 历史条目（只允许追加）。
- 在空状态或指南中展示伪造的运行结果、模拟成功数据。
