# 设备调试工具架构

2026-11-12，TASK-038。实际验证见 PROJECT_STATUS。

- Vue3/Vite + Express，沿用原安卓和Unity日志服务。后端只生产依赖 express、yauzl；前端仅 vue、vue-router、qrcode；不引入SQLite、sharp/canvas、地球、编辑器或模型模块。
- backend/src/server.js 创建应用/访问策略/两模块/健康及生产静态托管；index.js 负责端口、监听和关闭。version.js 从 package.json 获取产品版本；没有主线更新器，不自动检查GitHub latest。
- frontend/src/App.vue 为独立导航容器；Tools.vue 是双工具首页，AndroidWireless.vue 与 UnityLogs.vue保留模块，Settings.vue复用 ADB 弹窗。静态产物不包含其他模块或对其接口的访问。
- 原有 Local/Lan 访问策略在后端和 Vite 代理前复用。生产3100、开发5174，避免完整工具箱3000/5173。机器配置位于本应用data/，独立安装目录 %LOCALAPPDATA%/device-debugger，日志只记元事件而不记设备正文/口令。
- 原进程固定参数、隐藏窗口、超时、有界输出、取消；请求终止、切换设备、离页和服务退出清理。Unity访问仅私网固定协议和短期票据，ADB明确设备并保留安装/命令确认，不扩大原模块行为。
- 发布白名单包含两个模块的完整依赖和内置Node；runtime/check.js验证真实依赖可加载，不做SQLite ABI检查。启动/停止沿用路径/创建时间/端口归属身份验证；独立标签/安装ID/资产和产品清单避免跨产品自动更新。无认证，只用于可信本机/内网。


## Unity persistentDataPath 文件管理（2026-11-12 / TASK-039）

`android-persistent.js`负责当前用户/已安装应用/标准外部目录定位、固定shell协议、路径隔离、目录/内容读取与确认版本替换。`android-persistent-api.js`单独注册在安卓router，共用真实网络/同源/专用头保护，仅其upload端点允许二进制；`AndroidPersistentFiles.vue`与`android-persistent-client.js`独立封装视图和传送，原安卓页面负责互斥状态与配置生命周期。两产品模块代码保持一致，不引入持久化结构或依赖。替换以用户主动选择+确认、版本检查和SHA256核验保护，无法阻止App并发写入，指南提醒先关闭App并下载备份。

## APK 包名读取（TASK-040 / F-ADB-003）

android-apk-manifest.js负责有界二进制XML解析；android-apk-info.js复用原APK流式临时接收/ZIP结构检查，读取根清单并校验CRC，不运行外部进程或依赖SDK。安卓服务注册独立单任务读取器，API仅对精确inspect端点接受二进制，仍走同源及真实网段保护。AndroidApkInfo.vue和专用客户端管理上传、复制、取消与迟到结果，不依赖ADB配置或设备。无新增依赖/持久化结构；两产品源码一致，任务结果只在当前页。

## 多APK队列（TASK-042）

android-apk-queue.js解析专用长度前缀元数据与连续APK流，严格验证数量/大小/目标/任务矩阵并临时落盘；同一ADB独占锁内调度最多两台设备，每台串行，逐项复核在线状态及install -r输出。全部工作线程退出后才清理，失败重试只接受已确认矩阵，日志不记文件名/设备输出；不增加依赖或持久化。旧单包接口不变。

## 06 石墨字标资产与快捷方式（TASK-044）

assets/icons/ico 与 svg 保存用户选定的 Windows 资产及矢量源；frontend/public/icons 提供 Vite 原样复制的同源品牌资源，index.html 引用 favicon，App.vue 使用静态品牌图像，尺寸走 tokens，业务图标体系不变。create-shortcuts.ps1 只通过 WScript.Shell 保存 .lnk，不执行应用；明确固定入口、工作目录与 ICO，不接受自由命令，拒绝链接输出目录。Windows PowerShell 脚本采用 UTF-8 BOM，CMD 为 ASCII/CRLF。打包脚本显式复制资产和创建入口，安装器指定 SetupIconFile、UninstallDisplayIcon 及各快捷方式 IconFilename；本机快捷方式被 Git 忽略，无新增数据结构或依赖。
