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
