# 变更记录（CHANGELOG）

格式：日期 + 类型 + 条目。**只追加，不改写历史。**当前进度以 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为唯一来源，本文件不承载状态。

## 2026-10-20

### 批量功能改为显式开关 + 修复更多操作菜单位置（实现 + 浏览器验证，待 Codex 验收）

### Changed
- **批量功能改为显式开关**：工具栏新增「批量」按钮（开启时 accent 高亮）。只有开启批量模式才显示复选框列与批量操作条 —— 改前每行常驻一个空框，视觉噪声大，且让「点击行 = 打开详情」这条主路径的语义被稀释。关闭批量模式时清空已选（留着选择会让下次进入时不知道选了什么，误操作风险高）。
- **批量模式下点行只切换选中，不打开详情** —— 否则用户勾选一批资源时右侧详情面板不断跳。
- 菜单定位改为「先渲染 → 再测量 → 最后定位」，并**右边缘对齐按钮右边缘**（按钮在表格最右列，右对齐时菜单自然落在按钮左侧）；定位完成前 `visibility: hidden`，避免菜单闪到左上角再跳到位。

### Fixed
- **「更多操作」菜单整块跑到视口外**（用户反馈「资源二维码下面那个三个点点击后弹窗位置有问题」）。根因不是坐标算错，而是：`.main-content` 上有 `backdrop-filter: blur(30px)`（玻璃拟态），按 CSS 规范 `backdrop-filter` / `filter` / `transform` 都会创建**包含块**，使后代 `position: fixed` 改为**相对该元素定位**而非相对视口。菜单按视口坐标算出 `left=1397px`，实际渲染在 `1648px` —— 差值 251px 恰为 `.main-content` 的 250px 左偏移。修法：用 `<Teleport to="body">` 把菜单挂到 body，脱离该包含块。
- 菜单定位原先硬编码宽度 176px，实际渲染宽 188px —— 改为测量真实尺寸。
- 菜单元素原先用 `document.querySelector('.am-menu')` 取，两个菜单共用该 class 时只会取到第一个，量到的可能是另一个菜单的尺寸 —— 改用 `ref`。
- `verify-assets.mjs` 三处断言依赖「复选框常驻」的旧行为：按 `children[2]` 索引取类型列（复选框列隐藏后索引错位）、直接 click `.am-check`（元素不存在报 null）、「取消选择后批量条消失」（新语义下批量条跟随批量模式而非选中数量）—— 均按新语义修正。

### Added
- `frontend/verify-batch-mode.mjs`：21 项验收（默认无复选框、开启后出现、退出清空、批量模式点行语义、菜单完整在视口内、菜单右边缘对齐、菜单项文字未被压扁、文件夹菜单同样在视口内）。

### 验证证据
- 前端 `verify-batch-mode` 21/21；全量回归 297/297（vditor 18 + help 17 + hint 20 + cards 18 + assets 32 + storage 32 + preview 23 + qr 18 + batch-mode 21 + ui-verify 53 + batch-delete 45）。
- 后端 `npm test` 243/243（本轮无后端改动）。
- 实测：菜单 `left=1397`，右边缘 1585 = 按钮右边缘，完全在视口内；修复前为 `left=1648`、右边缘 1836（超出视口 1700）。
- 生产构建通过。

## 2026-10-20

### 二维码分享：页面二维码与资源下载二维码（实现 + 浏览器验证，待 Codex 验收）

### Added
- `frontend/src/assets/qr-share.js`（新模块）：对外访问地址读写、分享 URL 构造、二维码 SVG 生成。
- `frontend/src/components/assets/AssetQrDialog.vue`：二维码弹窗（页面 / 资源两用）。
- `frontend/verify-qr-share.mjs`：18 项验收。
- 新增依赖 `qrcode` 1.5.4。

### 功能
- **页面二维码**：主导航底部（所有页面通用）+ 资源管理页工具栏，扫后手机打开当前页面。
- **资源下载二维码**：List 视图每行 + Grid 视图卡片悬浮，扫后手机直接下载该资源文件。
- **对外访问地址可配置**（存 localStorage）。手机扫码必须能访问到服务器，而 `127.0.0.1` 指向手机自己 —— 未配置时 UI 明确提示「请填写本机内网 IP」，不给一个扫了没反应的码。

### 实现要点
- **用 SVG 不用 PNG**：矢量任意缩放不模糊、体积小（一段 path 而非 base64）、颜色可控能跟随主题。
- **qrcode 动态 import**：静态 import 会进主 chunk（所有页面首屏都付 25KB）；动态 import 后 Vite 拆成独立 chunk（25.7KB），主 chunk 152.74KB → 127.14KB。
- **深色主题前景色反转为浅色**（`#e7ecf5`）—— 深底深码扫不出来。
- **下载地址带 `?download=1`** —— 服务端返回 `Content-Disposition: attachment`（实测含 RFC 5987 中文名编码），手机浏览器直接触发下载而非在标签页打开。
- **资源下载二维码优先指向 published 版本** —— 对外分享应给正式发布的那版，而非仍在草稿中的最新版；未发布过才退回 latest。

### 验证证据
- 前端 `verify-qr-share` 18/18；全量回归 276/276（vditor 18 + help 17 + hint 20 + cards 18 + assets 30 + storage 32 + preview 23 + qr 18 + ui-verify 53 + batch-delete 45）。
- 后端 `npm test` 243/243（本轮无后端改动）。
- 生产构建通过。

### Fixed
- `verify-asset-storage.mjs` 的「工具栏有导入/导出/存储路径**三个**按钮」写死了数量，加二维码按钮后误报 —— 改为检查关键按钮都在（`NEEDED.every(...)`），不再随功能增加而误报。

## 2026-10-20

### 预览管线：服务端生成缩略图与预览图（实现 + 浏览器验证，待 Codex 验收）

### Added
- `backend/src/asset-preview.js`（新模块）：预览管线，采用「处理器注册表」架构 —— 管线调度与具体处理分离，新增资源类型只需加一项处理器。
- `backend/src/asset-preview.test.js`：14 项测试（处理器注册、图片预览、GLB 统计、文本预览、失败处理、重新生成）。
- `frontend/verify-asset-preview.mjs`：23 项验收（缩略图真实显示、预览走预览图端点、状态徽标、失败原因可见、重试入口）。
- 新增依赖 `sharp`（图片解码/缩放/编码，预编译二进制）。

### 处理器
| 类型 | 产出 | 说明 |
|---|---|---|
| 图片 | preview(≤1600px WebP) + thumbnail(256×256 cover) | 统一转 WebP：JPEG 对含透明通道的 PNG 会丢透明，WebP 体积又小 60~80% |
| 3D 模型 | 统计元数据 | 解析 GLB 的 JSON chunk（gltf 直接读 JSON），得出 meshes/vertices/triangles/materials/textures/animations/nodes/generator |
| 文本 | 截断的纯文本预览 | 上限 64KB，截断点落在多字节字符中间时切掉残缺尾巴；JSON 自动格式化 |
| 音频 | 基础信息 | WAV 头解析时长/声道/采样率，其余格式仅给文件大小 |
| 视频 | —— | **当前服务器未安装 ffmpeg，如实标记为 failed 并说明原因**，处理器位置保留，装上 ffmpeg 即可实现抽帧 |

### 行为约定
- **每个版本独立**：派生文件落在 `<assetId>/<versionId>/` 下，绝不与其它版本共享 —— 满足「所有历史版本共享 Latest 预览」的反面要求。
- **失败不影响原件**：处理器抛错只把 `preview_status` 置为 `failed` 并记录 `preview_error`，原始文件与元数据完好。
- **异步不阻塞上传**：上传落盘后置 `pending`，后台处理完改终态；前端轮询（1.5s）跟进状态。
- **三态区分**：`none`（该类型本就不做预览，不算失败）/ `failed`（真出错，附原因）/ `ready`。
- **存量补生成**：管线只在上传时触发，接入前已存在的资源会永远停在 `pending`；服务启动时 `backfillPreviews` 扫一遍补跑。

### Fixed
- 图片 PreviewProvider 未使用服务端生成的 preview 图，直接加载**原图** —— 8000×6000 的 TIFF 有 140MB，浏览器解码会卡死主线程。
- 图片 `load` 事件监听顺序错误（先设 src 等 load 再 append 到 DOM）—— 未插入文档的 img 在部分浏览器不触发 load，表现为「图片一直不显示」。改为先 append。
- **error 回调竞态**：切换预览时上一个 img/video/model-viewer 仍在加载中被移除，其 error 事件晚到一步，导致在新预览已就绪的情况下又插入一个错误框。三个 Provider 均加 `isConnected` 守卫。
- 详情面板 `previewStatus` 取错层级（优先用了 asset 顶层的聚合值，详情接口里该字段不存在、恒为 `none`）—— 改为优先取最新版本的状态。
- 详情面板重试失败时写 `this.previewError`（computed，只读）—— Vue 会警告且不生效，改用独立的 `retryError` 字段。
- 列表缩略图判断依据从「类型是不是图片」改为「服务端是否真的生成了」—— 前者会让每个图片都发起一次注定 404 的请求。
- `asset-api.test.js` 两条断言因行为变化过时（「预览未生成 → 404」在管线接入后不成立）—— 改为验证自动生成，并在 `asset-preview.test.js` 用 zip（status=none）补测 404 路径。

### 验证证据
- 后端 `npm test`：243/243 全过（新增 14 项）。
- 前端 `verify-asset-preview` 23/23；全量回归 258/258（vditor 18 + help 17 + hint 20 + cards 18 + assets 30 + storage 32 + preview 23 + ui-verify 53 + batch-delete 45）。
- 实测：542KB PNG → 缩略图 6.4KB（84×）、预览图 13KB（42×）；派生文件格式为 WebP，尺寸 256×256 与原图等比。
- 生产构建通过。

## 2026-10-20

### 资源保存路径设置 + 资源导入导出（实现 + 浏览器验证，待 Codex 验收）

### Added
- `backend/src/asset-mirror.js`（新模块）：镜像目录管理 —— 路径校验、配置读写、全量/增量同步、统计、清空。配置存 `asset_settings` 表（迁移 005）。
- `backend/src/asset-transfer.js`（新模块）：导入导出 —— manifest 构造、ZIP 流式读写、id 重映射导入。
- `backend/src/asset-mirror.test.js`：23 项测试（路径校验 + 同步 + 导入导出）。
- `backend/src/migrations/004_placeholder.sql`：编号占位（004 原拟用于拼音排序键，改用应用层排序后空出；SQLite 迁移器要求版本号连续）。
- `frontend/src/components/assets/AssetStorageSettings.vue`：存储路径设置弹窗（展示主存储位置、路径校验、镜像统计、立即同步/清空/停止同步）。
- `frontend/verify-asset-storage.mjs`：32 项验收。
- 新增依赖 `archiver`（流式写 ZIP）、`yauzl`（流式读 ZIP）。

### 语义说明
- **保存路径是「镜像目录」而非主存储切换**。主存储（`data/assets/<assetId>/<versionId>/`）永远是服务端权威副本；设置路径后立即把现有资源全量拷贝过去，之后每次上传自动增量同步。外部盘掉线只影响同步，不影响主存储 —— 若允许切换主存储，存量资源的 storage_key 会全部失效且无兜底。
- **导入会重新分配全部 id**，只保留引用关系（folder 父子、asset→version、latest/published 指针）。同一个包可重复导入，得到两份独立资源。

### Security
- 镜像路径必须**绝对路径**（相对路径随进程工作目录漂移）、必须**已存在且是目录**（不自动创建未知层级目录）。
- 镜像路径**不得是主存储本身/其子目录/其上级目录** —— 否则全量同步会自我递归。
- 写入时用 `relative()` 做二次边界校验，防符号链接与路径穿越。
- 导入解压时逐条校验条目路径必须解析后仍在目标目录内，否则拒绝整个包。
- 导出的存储文件名保持服务端生成形态（`original<时间戳>-<16位hex>.<ext>`），不采用用户提供的文件名。

### Fixed
- 漏 import `mirrorVersion` 导致镜像同步**静默失效**（异常被 catch 吞成 warn）。同步失败现在额外写一条 `mirror_failed` 操作日志。
- 导入的资源落盘缺 `versionId` 目录层 → `resolveAssetPath` 白名单不匹配，**导入成功但文件下载 404**。
- 导入文件名用 `Math.random().toString(16)` 长度不定（11~13 位），白名单要求恰好 16 位 hex → 同样导致 404。改用 `randomBytes(8).toString('hex')`。
- `yauzl.open` 回调参数名 `err` 遮蔽了外层业务错误构造函数 → 异常被 Promise 吞成未处理 rejection，**接口永不返回、测试挂死**。
- 导入时 versionId 是自增主键、插入前拿不到 → 改为「先插版本行拿 id → 再按 id 建目录落盘 → 回填 storage_key」。
- 存储路径弹窗的校验/保存按钮改读输入框 DOM 当前值（`v-model` 同步存在时序差）。

### 验证证据
- 后端 `npm test`：227/227 全过（新增 23 项）。
- 前端 `verify-asset-storage` 32/32；全量回归 233/233（vditor 18 + help 17 + hint 20 + cards 18 + assets 30 + storage 32 + ui-verify 53 + batch-delete 45）。
- 实测：设置路径后立即全量同步 16 个文件，目录结构与主存储一致；新上传自动同步 16 → 17；导出包含 manifest.json + 4 个版本原文件；导入得到 1 资源 / 1 文件夹 / 4 版本且 `latest=4 published=1` 分离关系正确保留。
- 生产构建通过。

## 2026-10-20

### 知识库与首页改为文档卡片（实现 + 浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js` 新增 `toPlainText()`：把Markdown 正文压成纯文本单行，供列表摘要使用。按顺序剥掉代码块、行内代码标记、图片、链接 URL、标题/引用/列表/表格/分隔线等结构性标记，再折叠空白。目的是摘要读起来像句话，而不是漏出 `## `、`**`、`](` 这类源码噪声。
- `listDocuments()` 现在返回 `snippet`（正文开头 140 字），并**不再返回 `content_md` 全文**。原实现用 `SELECT d.*`，列表一次拉 200 条会把每篇正文全部回传，响应体积随库线性膨胀；现改为列表只取元信息字段，再按本页 id 分批取正文生成摘要（占位符参数化，无注入风险）。
- `frontend/src/views/KnowledgeBase.vue`：文档列表从「一行一条」改为**自适应卡片网格**（`repeat(auto-fit, minmax(300px, 1fr))`），卡片内含标题、2行摘要、标签、时间、悬停编辑按钮。勾选框移入卡片标题行。
- `frontend/src/views/Home.vue`：最近更新同步改为卡片网格，与知识库共用同一套视觉语言。
- `frontend/verify-cards.mjs`（新，18 项断言）。

### Changed
- 摘要固定 `-webkit-line-clamp: 2` + `flex: 1`，保证同一排卡片等高、整排底边齐平；无摘要时以「暂无内容」占位。
- 网格用 `auto-fit` 而非 `auto-fill`：`auto-fill` 会保留空轨道，3 张卡片在2 列宽容器里第 3 张独占一行、右侧留大片空白。
- 响应式不再靠固定断点隐藏列（原先 ≤1500px 隐藏时间列、≤1340px 隐藏标签列），改由 `minmax + auto-fit` 自动降列，逐级折叠的意图得以保留。
- `verify-batch-delete.mjs` 的地址改为 `VERIFY_BASE` 环境变量优先，原先硬编码 5175，换端口即失效。

### Fixed
- 工作日志类文档的摘要原本会显示成「2026-10-19 海昏侯，修复AR内容 2026-10-20 ...」——全是日期、读不出信息。现逐条剥离日期前缀。**仅在无关键词时剥离**：搜索时用户可能正是按日期检索，抹掉会破坏检索。

### 验证证据
- 后端 `npm test`：115/115 通过。
- 前端 `verify-cards` 18/18（含 snippet 质量、卡片多列、同排等高、line-clamp、响应式降列 1068px→3列 / 900px→2列 / 520px→1列）。
- 回归：verify-vditor 18/18、verify-help 17/17、verify-hint 20/20、ui-verify 53/53、verify-batch-delete 45/45。
- `npm run build` 通过；Light/Dark 两套主题截图核对（卡片等高、摘要可读、宽度填满）。
- 列表接口实测返回字段：`id,title,category_id,version,parent_id,created_at,updated_at,category_name,tag_names,tags,snippet`——已无 `content_md`。

### Notes
- `.app-layout` 的 `min-width: 1280px` 是刻意设计（窄屏横向滚动而非整体缩放），符合「响应式逐级折叠侧栏、不缩放页面」的规范；因此响应式断言改为主动改变主内容容器宽度来测，而非改视口宽度。
- 本次仅改前端展示与列表接口返回字段，**未改动任何业务逻辑，未删除任何已有功能**；批量删除、搜索、标签筛选、导入导出均照常可用（45/45 回归通过）。

## 2026-10-19

### TASK-012 Markdown 图片附件 + 备份导出可选 gzip（实现 + 浏览器验证，待 Codex 验收）

### Added
- `backend/src/uploads.js`（新模块）：图片落盘到 `<项目根>/data/uploads/`。**文件名完全由服务端生成**（`时间戳-16位十六进制.扩展名`），绝不采用用户提供的文件名，从根上杜绝路径穿越。`resolveUploadPath()` 用正则白名单 + `path.relative` 边界校验双重把关。
- `backend/src/api.js`：新增 `POST /api/uploads`（multipart 上传，字段名 `image`）、`GET /api/uploads/:filename`（读取图片，长缓存）；`GET /backup/export?format=gz` 返回**原始 gzip 字节**。
- `frontend/src/views/DocumentEdit.vue`：编辑器新增「🖼插入图片」按钮，支持三种入口——按钮选文件、**Ctrl+V 直接粘贴剪贴板截图**、拖拽图片到编辑区。上传完成后在光标处自动插入 `![文件名](/api/uploads/xxx.png)`，alt 取自文件名。
- `frontend/src/views/KnowledgeBase.vue`：导出改为**下拉菜单**，可选「JSON 文件（.json）」或「压缩文件（.json.gz）」；导入端兼容 `.gz`（按 gzip 魔数而非扩展名识别，用浏览器内置 `DecompressionStream` 解压，不引入解压库）。
- `backend/package.json`：新增唯一依赖 `busboy`（multipart 解析）。

### Security
- 图片类型校验采用**扩展名白名单 + 文件魔数双重校验**，把 `.exe` 改名成 `.png` 也会被拒绝（实测 `MZ` 开头伪装文件返回 400）。支持 png / jpg / jpeg / gif / webp / bmp / avif。
- **默认拒绝 SVG**：SVG 可内嵌 `<script>`，虽经 `<img>` 加载一般不执行，仍属不必要的风险面。
- 不限制单张图片体积（用户明确要求），仅设 512MB 整体兜底上限防止内存被打满。
- Markdown 渲染白名单已含 `img`，且实测 `/api/uploads/...` 路径可原样保留；同时确认 `javascript:` 协议被剥离、`onerror` 属性被丢弃，安全边界未被放宽。

### Notes
- **图片存链接而非 base64 内嵌**（与用户确认的方案）：Markdown 保持可读可编辑、正文不暴涨。代价是**备份 JSON 只含图片链接，换机器恢复需另行拷贝 `data/uploads/` 目录**，已在代码注释中说明。
- **gz 导出刻意不设 `Content-Encoding: gzip`**：若设置，浏览器会自动解压，前端拿到的将是明文而非可保存为 `.gz` 的压缩流；前端改用 `arrayBuffer()` 取原始字节。
- 体积实测（2000/10000 页）：JSON 明文 ≈ SQLite 的 0.94倍，**gzip 后约为 SQLite 的 0.9%**（10000 页 14.56MB → 127KB），因此导出菜单推荐压缩格式。

### Fixed
- `resolveUploadPath` 路径边界校验在 Windows 上恒失败：原实现用 `abs.startsWith(resolvePath(UPLOAD_DIR) + '/')`，但 Windows 分隔符是 `\`，拼接 `/` 后永远不匹配，导致**所有上传成功的图片都无法读取（404）**。改用 `path.relative` + `startsWith('..')` 判断，与平台无关。
- `UPLOAD_DIR` 原按 `process.cwd()` 解析，在 `backend/` 下启动时会落到 `backend/data/uploads`，与位于项目根的数据库目录错配。改为与 `db.js` 一致以 `PROJECT_ROOT` 为基准。
- Express 5 的 `req` 不是原生 Request，**没有 `req.formData()`**（运行时抛 `TypeError`），故 multipart 解析改用 busboy。

### Verified
- 后端 `npm test` **106/106 通过**（新增 6 组用例：PNG 上传并读回、URL 在渲染中不被净化、非图片扩展名 400、伪装 PNG 魔数校验、路径穿越 404、gz 导出真实字节且解压内容一致）。
- curl 联调：上传中文名 `架构图.png` → 201，读回 200/image/png，Markdown 渲染输出 `<img src="/api/uploads/...">`；`.exe` 与伪装 PNG 均 400；`..%2F..%2F` 穿越 404；gz 导出魔数 `1f 8b`、解压后与明文导出逐字段一致（仅导出时间戳不同）。
- 真实浏览器 CDP **17/17 交互断言 PASS**：插图按钮渲染且可点击、隐藏 file input 限定图片类型、上传后自动插入 Markdown、alt 取自文件名、预览区 `<img>` **真实加载成功（60×40 非破图）**、导出下拉菜单含两种格式、gz 文件名正确、导出字节为真gzip（魔数 1f 8b）、浏览器端可解压且文档数正确、导入 `.gz` 自动识别解压并重建父子层级、后端拒绝非图片上传。控制台 0 异常，`npm run build` 通过。

### 数据导入 / 导出（F-KB-007 + F-OPS-002，实现 + 浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js`：新增 `BACKUP_VERSION = 1`、`exportSnapshot()`、`importSnapshot()`。快照**刻意使用名称与相对引用而非自增 ID**——分类/标签按名称、文档父子关系按 `ref` / `parent_ref`——因此备份文件可跨库、跨机器还原。导出含分类、标签、文档正文、父子层级、创建/更新时间。
- `backend/src/api.js`：新增 `GET /api/backup/export`、`POST /api/backup/import`。
- `backend/src/index.js`：JSON body 限制由 2mb 放宽至 16mb（原值不足以承载较大知识库的导入）。
- `frontend/src/api/client.js`：新增 `exportBackup()` / `importBackup(snapshot)` 封装。
- `frontend/src/views/KnowledgeBase.vue`：列表工具栏新增「导出 / 导入」按钮。导出走 fetch → Blob → 本地下载 `team-toolbox-backup-<时间戳>.json`（不在服务端落盘）；导入走隐藏 file input → 解析 JSON → 校验 → `confirm` 确认 → POST → 提示新增/跳过/新建分类数量，并刷新分类、标签、页面树与列表（派发 `kb-changed`）。

### Import 语义
- **合并模式**，不删除既有数据。
- 分类按名称复用，不存在则新建（受 50 上限约束）。
- 文档以「同父级下同名」判定已存在并跳过；因此**重复导入同一份备份是幂等的**。
- 逐层推进重建父子层级；父级缺失或成环的文档降级为顶层导入并记入 `details`，保证数据不丢。

### Fixed
- `importSnapshot` 幂等性缺陷：页面因「同父级同名」被跳过时未登记 `ref → 既有 ID` 映射，导致其子页面误判"父级不在备份中"而被降级为顶层导入，重复导入会产生重复页面。现已在跳过分支同步登记映射。
- `KnowledgeBase.vue` 按钮永久禁用：`:disabled="ioBusy"` 中 `ioBusy` 以空字符串表示"空闲"，而 Vue 3 对空字符串求值为真，导致导出/导入按钮始终渲染为 `disabled`、完全无法点击。改为 `:disabled="ioBusy !== ''"`。

### Verified
- 后端 `npm test` **100/100 通过**（store 44 + api 56，含本次新增 4 组备份用例：快照可移植性、非法备份 400、导出→再导入全跳过幂等、父子层级与分类重建）。
- curl 联调：导出 13 篇/3 分类；原样重导入 `imported:0, skipped:13`；新数据导入 3 篇并正确重建父子关系、分类归属与孤儿降级。
- 真实浏览器 CDP 端到端 **10/10 PASS**：按钮渲染、初始未禁用、隐藏 file input、无文件时静默、导出生成 Blob 下载链接、导出后按钮状态恢复、导入备份文件成功、重复导入幂等、新页面导入后列表与页面树同步刷新、统计数字正确。控制台 0 异常，`npm run build` 通过。

### TASK-011 工具箱首个工具：比例锁定（实现 + 浏览器验证，待 Codex 验收）

### Added
- `frontend/src/views/RatioLock.vue`（新工具页 `/tools/ratio-lock`）：**比例锁定换算**。三步流程——① 原始尺寸（支持 `1920*1080`、`1920x1080`、`1920×1080`、逗号/空格分隔，或直接填宽/高两框；内置 16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9 预设）→ ② 锁定当前比例（显示最大公约数约分后的比例，如 1920×1080 → 16:9，及 `1 : 0.5625`）→ ③ 按比例换算（输入目标宽度自动得高度，输入目标高度自动得宽度，结果卡片 + 一键复制）。
- `frontend/src/router/index.js`：新增 `tool-ratio-lock` 路由。
- `frontend/src/views/Tools.vue`：工具卡片新增「比例锁定」并置于首位，状态徽标支持「可用/规划中」两态（可用为绿色），按钮文案区分「打开工具 / 查看详情」。

### Notes
- 纯前端计算，不涉及后端与数据存储；结果统一按两位小数显示（避免浮点噪声如 `924.4444444`），精确值不整除时在下方提示"已按两位小数显示"。
- 非法输入（非数字、非两段、非正数）行内报错，不锁定；锁定状态下修改原始尺寸或点击预设会同步更新基准比例并重算已填值。
- 范围说明：用户明确要求工具箱先实现该工具，属 MVP 原计划（工具箱仅保留框架）之外的新增范围，单独记为 TASK-011，不影响既有 TASK 编号与特性矩阵。**待 Codex 验收。**

### Verified
- 真实 Edge（CDP，脚本置于 `.workbuddy/ui-verify`，用后清理）8 项断言全 PASS：工具箱 3 张卡片且「比例锁定」置首/状态「可用」；进入 `/tools/ratio-lock`；输入 `1920*1080` 自动拆分宽 1920/高 1080；锁定后提示「基准 1920 × 1080，比例 16:9」；输入目标宽度 520 → 目标高度自动填 292.5、结果卡片 `520 × 292.5`；输入目标高度 520 → 宽度自动填 924.44、结果 `924.44 × 520`；非法输入 `abc*100` 行内报错；预设 1:1 在锁定态下同步基准为 1080×1080；解锁后换算区回到占位提示。控制台 0 异常，`npm run build` 通过。

### 二级菜单内恢复父子层级：子页面缩进显示在父页面下方（待 Codex 验收）

### Fixed
- `frontend/src/components/PageTree.vue` + `App.vue`：二级「页面」菜单恢复递归层级渲染——有子页面的父页面显示 › 展开箭头，子页面缩进（`8px + depth×16px`）显示在其父页面正下方；打开子页面时自动展开其父页面（`focusActive`）。此前按"二级页面不出现在一级页面上"扁平化，导致子页面在菜单中无入口、看不到归属关系。

### Verified
- 真实 Edge（CDP）断言全 PASS：`/kb/10` 二级菜单 13 行（10 顶层 + 3 子页面），父页面「技术分享纪要」高亮且箭头处于展开态，子页面缩进 24px 排列于其下（方法 / 地方 / 单独）；点击箭头折叠回 10 行、再展开回 13 行；点击子页面跳转 `/kb/11`「方法」且面包屑为 知识库 / 技术分享纪要 / 方法；侧边栏仍只有三个一级导航；控制台 0 异常；`npm run build` 通过。

### Notes
- 与上一条"二级菜单移到右侧主内容区"并存：菜单**位置**在右侧主区（不再占用一级导航栏），菜单**内部**保持父子层级缩进。

### 导航层级再调整：二级页面菜单移入右侧主内容区（待 Codex 验收）

### Changed
- `frontend/src/App.vue`：侧边栏只保留一级导航（首页 / 知识库 / 工具箱）；页面列表从导航栏移入**主内容区左侧的二级菜单** `.sub-menu`（宽 232px、右侧分隔线、`position: sticky` 顶部吸附），仅在 `/kb/*` 激活时渲染，标题为「页面」，保留「＋ 新建页面」入口。
- `.main-content` 改为 flex 容器（新增 `.content-body` 承载 `<router-view>`）；窄屏（≤768px）下二级菜单转为内容顶部横向区域并限高 42vh。
- 此前的 `.kb-subtree`（知识库下方缩进列表）样式随结构迁移移除。

### Verified
- 真实 Edge（CDP）4 路由断言全 PASS：侧边栏始终只有 3 个一级导航、无页面树；`/kb` 与 `/kb/10` 渲染二级菜单（标题「页面」、10 行页面、left=248/width=232、内容区从 x=480 起），`/` 与 `/tools` 不渲染二级菜单（内容区从 x=248 起）；控制台 0 异常；`npm run build` 通过。

### Notes
- 变更动机：用户要求「一级按钮只留一级，页面列表作为二级菜单放在旁边，以后二级菜单都这样放」——此后二级（子页面）入口统一位于右侧主内容区。

### 修复与导航结构调整（实现 + 浏览器验证，待 Codex 验收）

### Fixed
- `frontend/src/views/DocumentDetail.vue`：**详情页 → 详情页切换右侧内容不刷新**。Vue Router 在 `/kb/4 → /kb/3` 时复用同一组件实例，原实现只在 `mounted` 加载数据，导致 URL 已变而右侧仍显示上一篇文档（用户反馈"点击左侧页面按钮右侧没反应"）。新增 `watch: { docId(id, oldId) }`，参数变化时清空 `doc`/`renderedHtml`/`children` 并重新加载。
- `frontend/index.html`：新增内联 SVG favicon，消除开发期 favicon 404 请求。

### Changed
- `frontend/src/components/PageTree.vue`：由递归多级树退化为**扁平一级页面列表**——移除子级递归渲染、展开箭头（›）与 `expanded`/`toggle` 相关 props/emits。
- `frontend/src/App.vue`：侧边栏「页面」区块移入导航区内、紧跟「知识库」之后，`v-if="onKbSection"`（`$route.path.startsWith('/kb')`）——**仅知识库区块显示，缩进 22px 作为其二级列表**；同时移除 `expanded` 状态与 `localStorage` 折叠记忆（`loadExpanded`/`saveExpanded`/`toggleNode`/`focusActive` 全部删除）。
- `frontend/src/views/DocumentDetail.vue`：页面正文下方「子页面」区块加标题与数量徽标（`.child-heading` / `.child-count`）、顶部边框分隔与 `.child-list` 容器，二级页面统一在此列表展示。
- `.gitignore`：忽略本地工作区 `.workbuddy/`（记忆日志、验证脚本、截图不入库）。

### Verified
- 真实 Edge 浏览器（CDP，脚本置于 `.workbuddy/ui-verify`，用后清理）断言全部 PASS：首页/工具箱下侧边栏页面树隐藏（0 行）、`/kb` 与 `/kb/4` 显示 10 篇顶层页面且无子页面「方法」、无展开箭头按钮；打开「技术分享纪要」(`/kb/10`) 右侧「子页面 1」列表含「方法」；详情 → 详情切换（`/kb/4 → /kb/3`）标题正确切换为「Unity 实用技巧」；控制台 0 异常。
- `npm run build`（frontend）通过。

### Notes
- 变更动机：用户明确要求「侧边栏只保留一级页面入口，二级页面不要出现在一级页面上，改为在右侧生成列表展示」；同时修复其反馈的点击无反应问题。
- 仍待 Codex 验收。

### TASK-008 首页最近更新（实现 + 单测/浏览器验证，待 Codex 验收）

### Changed
- `frontend/src/views/Home.vue`：「最近更新」区块由静态占位改为真实数据驱动——`mounted` 调用 `api.listDocuments('?limit=20&offset=0')`，渲染标题/分类 pill/标签 pill/更新时间；「查看更多」增量分页（`hasMore = recent.length < recentTotal`）；点击条目跳 `/kb/:id`；空库空状态引导「新建文档」（跳 `/kb/new`）；加载中/失败重试状态齐备，失败不丢已有列表。修复初版误用 `res.items`/`res.total`（应为 `body.items`/`body.total`）导致列表恒空的 bug。

### Verified
- `npm test`（backend）→ 5 suites / **96 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 搜索 +8 + 默认排序/分页/空结果 +4）。
- `npm run build`（frontend）→ 构建通过（Home 分块 4.34kB JS / 4.61kB CSS）。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）9 项交互断言全过：populated 场景首屏 20 条、首条标题非空、含分类/标签 pill、「查看更多」点击后 25 条、点击跳详情；empty 场景空状态渲染、含「新建文档」按钮、点击跳 `/kb/new`。
- 后端无新增代码：`store.listDocuments` 默认 `ORDER BY updated_at DESC`、limit 20 即满足 F-KB-008。

### Notes
- 覆盖 F-KB-008（首页最近更新）。首页"最近更新"与搜索、分类/标签筛选相互独立，符合 F-KB-008 仅要求默认视图展示最近更新的边界。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。
- 未提交 Git（与既有改动一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-007 搜索（实现 + 单测/浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js`：新增 `searchDocuments`（关键词参数化 `LIKE` 匹配标题或正文，不区分大小写；`%`/`_`/`\` 通配符转义为字面量防注入；空关键词返回空；结果按 `updated_at` 倒序、分页；附带 `snippet` 摘要片段）。
- `backend/src/api.js`：新增 `GET /search?q=&limit=&offset=`（空关键词不发起查询返回空结果）；文件头注释覆盖 F-KB-006。
- `frontend/src/api/client.js`：新增 `api.search(q, {limit, offset})`。
- `frontend/src/views/KnowledgeBase.vue`：用真实搜索框替换「搜索即将在 TASK-007 开放」占位；输入防抖 300ms 切换搜索模式，结果渲染标题/摘要/分类/标签；无结果空状态；分页「加载更多」；「清除」回列表；点击分类/标签 chip 退出搜索。

### Changed
- `docs/ARCHITECTURE.md` 第 9 节：搜索实现由"待决策"明确为参数化 `LIKE` 子串匹配方案（未引入 FTS5）。

### Verified
- `npm test`（backend）→ 5 suites / **93 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 搜索 +8）。
- `npm run build`（frontend）→ 构建通过（KnowledgeBase 分块 10.93kB）。
- 真实后端联调（curl，dev 库演示数据）：`?q=规范`→3 篇；`?q=Unity`→1 篇；`?q=50%` 特殊字符→0 不报错；空关键词→`{total:0,items:[]}`。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）8 项交互断言全过（搜索框、搜索「规范」→3 条且计数文案正确、清空回列表、无结果空状态、特殊字符「50%」不崩溃、清除按钮）。
- 中文搜索采用子串 `LIKE`，契合中文无词边界；通配符转义防注入。

### Notes
- 覆盖 F-KB-006（搜索）。搜索与分类/标签过滤相互独立，未做组合筛选。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。
- 未提交 Git（与既有改动一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-006 分类与标签（实现 + 单测/浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js`：`createCategory` 新增分类数量上限 50（达上限返回 `invalid_input`）；新增 `updateCategory`（空名→`invalid_input`、重名→`constraint_failed`、不存在→`not_found`，成功 `UPDATE categories SET name=?`）；`validateTags` 改为英文小写合并（`toLowerCase()`）+ 去首尾空白 + 去重（`[...new Set]`），单文档≤10；`listDocuments` 新增 `tags` 数组参数，用子查询 `HAVING COUNT(DISTINCT dt.tag_id) = N` 实现标签 AND 过滤。
- `backend/src/api.js`：新增 `PUT /categories/:id`（重命名）；`GET /documents` 解析 `req.query.tags`（逗号分隔或数组）传入过滤。
- `frontend/src/api/client.js`：新增 `createCategory` / `updateCategory` / `deleteCategory` / `deleteTag` 封装。
- `frontend/src/views/KnowledgeBase.vue`：左侧分类目录新增行内重命名（hover 显形「改名」+ 回车提交）、hover 显形「删除」（删除前查该分类文档数并 `confirm` 提示受影响数量，确认后删除；当前选中则置空为「全部文档」）、「＋ 新建分类」行内输入（1–30 字）；右侧新增标签 chip 多选筛选 + 「清除筛选」，筛选随 `tags` 参数触发并实时刷新计数与列表；分类增删改派发 `kb-changed` 同步侧边栏。
- `frontend/src/views/DocumentEdit.vue`：标签输入框补充提示（逗号分隔、英文自动小写去重）。

### Verified
- `npm test`（backend）→ 5 suites / **80 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 本次新增分类/标签用例 +11）。
- `npm run build`（frontend）→ 构建通过。
- 真实后端联调（curl，重置 dev 库后 seed）：`GET /api/documents?tags=zzalpha` → `total:3`（zz-X1/zz-R2/zz-R1）；`GET /api/documents?tags=zzalpha,zzbeta` → `total:1`（zz-R1）；`PUT /api/categories/1` 改名 → 200。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）7 项交互断言全过（点击标签 chip、仅 zzalpha→3 篇、zzalpha AND zzbeta→1 篇、分类重命名生效、分类删除生效）。
- 复盘：初版浏览器验证 5/7 FAIL（计数读到全部 17 篇），根因为后端进程为改动前陈旧实例（未重启、忽略 `tags`）；重启后端加载最新代码后复测 7/7 PASS，证实实现与前端均正确。

### Notes
- 覆盖 F-KB-004（分类新建/重命名/删除，删除置未分类）与 F-KB-005（标签小写合并、AND 过滤、单文档≤10）。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。
- 未提交 Git（与既有改动一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### 知识库页面树改造（Notion 功能形态，待 Codex 验收）

### Added
- `backend/src/migrations/002_page_tree.sql`：文档层级化——`documents` 新增 `parent_id`（自引用外键，`NULL`=顶层，`ON DELETE CASCADE`），并加 `idx_documents_parent_id` 索引。
- `backend/src/store.js`：新增 `validateParentId`（NULL/正整数校验）、`isSelfOrDescendant`（递归 CTE 防环）；`createDocument`/`updateDocument` 支持 `parent_id` 并在移动时防环；`getDocument` 返回 `path`/`child_count`/`descendant_count`；`listDocuments` 支持 `root`/`parent_id`；新增 `listDocumentTree`/`listChildren`。
- `backend/src/api.js`：`GET /documents` 支持 `root=1`/`parent_id=`；新增 `GET /documents/tree`、`GET /documents/:id/children`；`POST`/`PUT /documents` 接受 `parent_id`。
- `backend/src/store.test.js` / `backend/src/api.test.js`：新增页面树相关测试（共 +12 项断言）。
- `frontend/src/components/PageTree.vue`：递归页面树组件（展开箭头、hover ＋/···、行内重命名、缩进、active 高亮）。
- `frontend/src/components/DocIcon.vue`：单色描边 SVG 文件图标，替代 emoji。
- `frontend/src/App.vue`：侧边栏「页面」区块（PageTree + 新建页面）；页面 ··· 菜单（新建子页面/重命名/复制链接/删除）、删除确认含 `descendant_count`；展开状态 `localStorage` 持久化；`kb-changed` 事件同步刷新；进入自动展开当前页及祖先。
- `frontend/src/views/DocumentDetail.vue`：面包屑（知识库/祖先/当前页）+ 正文下方子页面列表 + ＋新建子页面入口 + 删除确认含 `descendant_count`。
- `frontend/src/views/DocumentEdit.vue`：父页面 select（层级缩进、编辑时排除自身及后代防环）；`?parent=` 预选；保存后派发 `kb-changed`。
- `frontend/src/api/client.js`：新增 `listDocumentTree`/`listChildren` 封装。

### Fixed
- `backend/src/migrate.js`：Windows 入口判断 `import.meta.url === file://${process.argv[1]}` 在反斜杠路径下恒 false 且 `runMigrations` 未 `await`，导致 002 迁移从未应用 → 改用 `pathToFileURL(process.argv[1]).href` 比较并 `await runMigrations`；`runMigrations` 报错设 `process.exitCode=1`。

### Verified
- `npm test` → 5 suites / **69 tests 全过 / 0 fail**。
- `npm run migrate` 现输出 `applied=1 versions=[2]`；`documents` 表含 `parent_id` 列。
- `npm run build`（frontend）→ 构建通过。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）16 项交互断言全过（树渲染/缩进/高亮、自动展开、子页面列表、面包屑、··· 菜单、行内重命名同步、新建子页面带 parent 参数、删除确认取消/确认、侧边栏自动刷新）。
- 演示数据：开发库灌入 10 篇文档（maxDepth=2）。

### Notes
- 应"按照 Notion 功能修改"（附 Notion 截图：侧边栏页面树 hover ＋/···、页面正文下方子页面列表）的要求；在前述 Notion 浅色外壳上改造为页面树 + 子页面形态。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。未提交 Git；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-003 文档 CRUD API（实现 + 接口测试，待 Codex 验收）

### Added
- `backend/src/api.js`：Express 路由器工厂 `registerApi(app, { getDb, basePath })`，实现文档（增/查/列表/改/删）、分类（增/查/删）、标签（查/删）的 HTTP 接口；统一错误码→HTTP 状态码映射（`sendError`：invalid_input→400、not_found→404、conflict→409、constraint_failed→409、其余→500），409 冲突响应附带服务端当前快照 `current`；`detail` 仅非生产环境暴露。
- `backend/src/index.js`：在 `express.json({ limit: '2mb' })` 之后挂载 `registerApi`，业务接口上线（原健康检查与 `_dev/render-markdown` 保留）。
- `backend/src/api.test.js`：接口级自动化测试（node:test + 临时 http server + fetch），23 tests 全过，覆盖 F-KB-001/002/003 的 API 部分与分类/标签关联读写；含 409 冲突、`current` 快照、分页、非法 ID、空标题/超长正文 400、重名 409 等用例。
- `backend/package.json`：`test` 脚本改为 `node --test src/store.test.js src/api.test.js`。

### Verified
- `npm test` → 5 suites / 57 tests（store 34 + api 23），**全部 pass / 0 fail**。
- 真实后端联调（curl）：分类创建 201；文档创建（带 category_id/tags）201；读取 200 含 tags；列表返回 `{ total, items }`（含 category_name/tags）；旧版本更新 **409 + current 快照**；正确版本更新 200 version 递增；空标题 400；删除 204 后 GET 404。验证后已清空开发库测试数据。
- 开发库 `data/team-toolbox.sqlite3` 联调前后均为空库（测试数据已清理）。

### Notes
- 依用户 2026-10-19 "继续" 指令，在 TASK-002 自测通过基础上推进 TASK-003；**TASK-002 的 Codex 正式验收仍待补**，不宣称验收通过。
- 范围边界：标签小写合并（F-KB-005）、按标签 AND 过滤、分类重命名、搜索（F-KB-006）、首页最近更新（F-KB-008）属 TASK-006/007/008，本次未做；前端接入 UI 属 TASK-005，接口尚未被 UI 消费。
- 未提交 Git（与 TASK-002 修复一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-005 Markdown 编辑与文档页面（实现 + 构建/联调，待 Codex 验收）

### Added
- `frontend/src/api/client.js`：统一 API 客户端，封装 fetch、相对 `/api` 前缀、网络错误标记（`err.network`）、204 无体处理；导出 `api` 对象（文档/分类/标签/渲染接口）。
- `frontend/src/views/KnowledgeBase.vue`：重写为真实数据列表——`GET /api/documents` 拉取（标题/分类/标签/更新时间）、启用「新建文档」入口、加载/错误/空状态、跳转详情与编辑。
- `frontend/src/views/DocumentEdit.vue`：新建/编辑页——标题（必填）/分类下拉/标签（逗号分隔）/Markdown 正文输入；`POST /api/markdown/render` 实时预览（后端净化）；保存按新建 POST / 编辑 PUT（带 version）；空标题 400 字段提示；409 冲突展示「加载最新（丢弃本地修改）/ 基于最新覆盖保存（二次确认）」双选项；sessionStorage 草稿恢复（断网/刷新不丢）。
- `frontend/src/views/DocumentDetail.vue`：详情页——拉取文档、`POST /api/markdown/render` 后端净化渲染（v-html 安全）、元数据展示、编辑入口、删除二次确认弹窗（显示标题，取消不删）。
- `frontend/src/App.vue`：新增全局 `.markdown-body` 排版样式，供编辑预览与详情页共用。
- `backend/src/api.js`：新增稳定的 `POST /api/markdown/render`（白名单净化，防存储型 XSS），从 `backend/src/index.js` 移除临时 `POST /api/_dev/render-markdown`（已合并）。

### Verified
- `npm run build`（frontend）→ 43 modules transformed，无报错。
- `npm test`（backend）→ 5 suites / 57 tests，全过 / 0 fail。
- 真实后端联调（curl）：渲染净化（`<script>`/`javascript:` 被剥离）；`_dev` 端点 404（已移除）；文档创建 201 / 读取 200 / 列表 `{total,items}`；错误版本更新 **409 + current 快照**；删除 204 后 GET 404。联调后清空开发库测试数据。

### Notes
- 覆盖 F-KB-001/002/003 的 UI 部分；浏览器交互式验收（冲突弹窗、草稿恢复、断网重试、双会话 409）属 FUNCTIONAL_SPEC 手工条目，需在浏览器执行，本会话仅完成构建与 API 契约层验证，不谎称交互验收已通过。
- 未提交 Git（与 TASK-002/003 一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### 知识库 UI 风格改造（Notion 化，待 Codex 验收）

### Changed
- `frontend/src/App.vue`：外壳由深色改为 Notion 浅色风格（白色主区 + `#f7f7f5` 侧边栏 + `#37352f` 文本 + `#2383e2` 链接蓝）；侧边栏新增工作区头部与区块标签；全局 `markdown-body` 改为 Notion 阅读排版（浅色代码块、舒适行距、链接下划线）。
- `frontend/src/views/KnowledgeBase.vue`：列表视图——页面图标 + 大标题 + 新建按钮；新增**左侧分类目录**（全部文档 + 各分类，点击按 `category_id` 过滤，复用 `/categories` 与 `GET /documents?category_id=`）；文档行 hover 显形「打开 / 编辑」。
- `frontend/src/views/DocumentDetail.vue`：Notion 居中阅读列（max-width 760px），大标题 + 页面图标 + 标签 pill + 更新时间 + 版本；顶部 hover 显形「编辑 / 删除」。
- `frontend/src/views/DocumentEdit.vue`：无边框大标题输入 + 居中写作列；新增「编写 / 分屏 / 预览」模式切换，保留实时预览、草稿、409 冲突、空标题 400 等全部逻辑。
- `frontend/src/views/Home.vue` / `Tools.vue`：补上居中容器以匹配去 padding 的主区。

### Verified
- `npm run build`（frontend）→ 构建通过（各视图/客户端分块产物正常）。
- 启动 `backend`（:3000）+ `frontend`（:5173，Vite 代理 /api）实时预览；为演示灌入 3 篇示例文档 + 2 个分类（开发库演示数据，可清空）。

### Notes
- 仅改动前端视觉与模板结构，**未改动任何业务逻辑**（API 调用、保存/冲突/草稿/校验），功能等价此前 TASK-005 实现。
- 交互式视觉验收（列表视图、目录过滤、阅读/编辑页观感、模式切换）需在浏览器手工确认；本会话仅完成构建与本地联调启动。
- 演示数据非功能必需；如不需可清空开发库 `data/team-toolbox.sqlite3`（或删除种子文档/分类）。
- 仍未提交 Git；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-002 修复：测试可运行 + 连接工厂支持 path 注入

### Fixed
- `backend/src/migrate.js`：`runMigrations` 改为 `async`（函数体内有 `await import('./db.js')`，原签名未声明 async，导致 SyntaxError: Unexpected reserved word）。
- `backend/src/errors.js`：`errorMap` 改为返回 `Error` 实例（携带 `code` / `detail` 属性）而不是普通对象；新增识别 `code === 'conflict'` / `context === 'conflict'`、`code.startsWith('SQLITE_CONSTRAINT_')`、`context === 'constraint_failed'`、`context === 'cannot_open'`、保留传入消息；不再让 `assert.throws(fn, /regex/)` 收到 `[object Object]`。
- `backend/src/db.js`：`createDatabase` 中 `mkdirSync` 失败映射为 `cannot_open`；`createTestingDatabase` 新增 `path` 注入参数，允许测试复用同一文件触发 busy lock；补回 `DB_PATH` 导出（`backend/src/index.js` 仍按文档预期使用）。
- `backend/src/store.js`：`createCategory` 中约束码识别改为 `SQLITE_CONSTRAINT` 或 `SQLITE_CONSTRAINT_*` 子码（better-sqlite3 抛 `SQLITE_CONSTRAINT_UNIQUE`），确保唯一约束违反被识别为重名。
- `backend/src/store.test.js`：把 `runMigrations` 调用统一改为 `await runMigrations`（配合 async 化）；`createTestingDatabase` 复用 `path` 参数，使"重开可读""独立连接忙锁""createDocument 持久化"用例可命中；`WAL` 用例改用文件 db（`journal_mode = WAL` 不适用于 `:memory:`）；`cannot_open` 用例改用 Windows 上明确不可写的盘符路径。

### Verified
- `npm run rebuild better-sqlite3` 成功（之前是为 Node 24 ABI 编译的 NODE_MODULE_VERSION 137，本机 Node 22 需 127）。
- `npm test` → 5 suites / 34 tests，**全部 pass / 0 fail / 0 cancelled**。
- `node src/index.js` 启动监听 127.0.0.1:3000；`GET /api/health` 返回 200，`db.ok=true`。
- `npm run migrate` 命令行入口仍可用。

### Notes
- 本次为修复 + 自测，**不代替 Codex 验收**。TASK-002 仍为"已实现（待 Codex 验收）"。
- 未启动：TASK-003 及之后任务；未动 frontend/*（属于阶段二 Codex 已验收范围，不在本修复 commit 中）。
- WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

## 2026-10-16

### TASK-001 技术栈与脚手架（待 Codex 验收）

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

### TASK-001 技术栈与脚手架（待 Codex 验收）
- 新增子项目 `backend/`（Node.js + Express 5 + better-sqlite3 + marked + sanitize-html）与 `frontend/`（Vue 3 + Vite 6）。
- 决策已写入 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节：Node.js v22 LTS、Express 5、better-sqlite3、手写迁移脚本、Vue 3 + Vite 6、Vue Router 4、marked + sanitize-html、SQL LIKE（参数化）、默认绑定 127.0.0.1。
- 新增 `backend/.env.example`、`frontend/.env.example`，子项目级 `.gitignore` 排除 .env、依赖、SQLite 与辅助文件；真实 `.env` 不入库。
- 实现 `backend/src/migrate.js`（扫描 `migrations/NNN_xxx.sql`，写入 `schema_migrations` 表）与 `backend/src/migrations/001_init.sql`（documents/categories/tags/document_tags + 索引 + 外键约定）。
- 实现 `backend/src/db.js`（PRAGMA WAL / foreign_keys = ON）、`backend/src/markdown.js`（marked + sanitize-html 白名单 + 强制 `rel="noopener noreferrer"`）、`backend/src/index.js`（`/api/health` + 临时 `POST /api/_dev/render-markdown`）。
- 实现 `frontend/src/App.vue`（阶段一占位页面：后端健康检查展示 + Markdown 渲染冒烟）。
- 实际验证：依赖安装（backend 117 包 / frontend 36 包）；`npm run migrate` 首次 applied=1、二次 applied=0 幂等通过；后端 `npm start` 监听 127.0.0.1:3000；`/api/health` 返回 200 含 db 信息；Markdown 渲染剥离 `<script>` 与 `javascript:` 协议外链；前端 `npm run dev` 启动 Vite、`/`、`/src/main.js`、`/src/App.vue` 均 200；`/api/*` 经 Vite proxy 命中后端返回正确 JSON；`npm run build` 生成 `dist/`。
- 文档：补充 [docs/USER_GUIDE.md](docs/USER_GUIDE.md) 第 4 节"本机启动（已验证）"；[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 同步更新至"阶段一脚手架完成，待 Codex 验收"；[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节决策落定。
- 未启动：未执行 git commit/push、未做内网部署验证、未引入测试、未实现任何业务接口（CRUD/分类/标签/搜索/最近更新）；下一阶段待 Codex 验收通过后再启动。
- WorkBuddy 使用模型：MiniMax-M3（M2/M3 派生）；积分：本次响应未返回积分字段，按 [AGENTS.md](AGENTS.md) 第 11 条记录为"积分未提供，无法确认"。
