# 设备调试工具 v0.2.0

本版增加多 APK 安装队列：一台或多台手机安装多个完整 APK，每台按文件顺序、最多两台并行，逐项反馈结果并精确重试失败组合。

同时在安卓调试中增加“查看 APK 包名”：选择单个 APK，点击读取后复制包名，无需手机、ADB 或 Android SDK。读取支持编译后的 UTF-8/UTF-16 清单，损坏或不支持的 APK 明确报错；不会安装、执行或保留安装包。

保留无线配对/连接、设备管理、单台/多台 APK 安装、常用及自定义 ADB 命令、应用状态/日志、屏幕刷新、Unity persistentDataPath 文件添加/替换和 Unity 局域网日志。

本产品使用 codex/device-debugger 分支、device-debugger-v0.2.0 标签、3100 端口及独立安装目录。提供 Windows x64 安装包、便携 ZIP、SHA256 和 device-debugger-manifest.json；不提供主工具箱 manifest.json，不改变工具箱自动更新源。

升级时先关闭软件并备份 data/，再安装本产品新版，或将 data/ 复制到全新解压目录。当前不提供自动更新。勿使用 team-toolbox 安装包覆盖本产品。

发布与验证结果以 [PROJECT_STATUS](../PROJECT_STATUS.md) 为准。隔离浏览器、公开 APK 只读解析及本机协议验证不代表真实手机安装、扫码、文件权限或另一物理客户端验收。服务仅面向受控本机/局域网。
