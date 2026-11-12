# 设备调试工具（Device Debugger）

从 [team-toolbox](https://github.com/GuiYe314/team-toolbox) 独立抽取的 Windows 网页设备调试工具。本分支只提供 **安卓无线调试** 与 **Unity 局域网设备日志**。

- 分支：`codex/device-debugger`；完整工具箱继续在 `main`，两者独立安装、独立数据、独立端口。
- 安卓：ADB 文件夹搜索、二维码/六位码配对、设备管理、六项常用及自定义命令、查看 APK 包名并复制、单台/多手机 APK 安装、单应用状态和 Logcat、手机屏幕连续刷新。
- Unity：局域网搜索 Android/iPad、历史日志、级别/关键词/堆栈筛选、自动刷新、复制及全文/ZIP 下载。
- 随包内置 Node，Windows 安装版及便携版无需另装 Node；ADB 需用户准备官方 Platform-Tools。
- 无知识库、资源库、模型、地球或 SQLite/图形原生依赖；只保存本工具的 ADB 路径和自定义命令。
- 默认可信局域网访问，生产端口 **3100**，源码开发前端 **5174**；`/local` 可仅本机。尚无账户权限，不开放公网。

使用见 [用户指南](docs/USER_GUIDE.md)，规格见 [FUNCTIONAL_SPEC](docs/FUNCTIONAL_SPEC.md)，开发计划见 [DEVELOPMENT_PLAN](docs/DEVELOPMENT_PLAN.md)，架构见 [ARCHITECTURE](docs/ARCHITECTURE.md)。**实际状态与验证唯一来源为 [PROJECT_STATUS](docs/PROJECT_STATUS.md)。**

发布使用独立标签 `device-debugger-v<版本>` 与资产前缀 `device-debugger-`；不得作为完整工具箱的 latest，不向其自动更新清单投放本工具。独立版当前手动下载安装更新，详见 [VERSION_POLICY](docs/VERSION_POLICY.md)。

新增 APK 包名与升级方式见 [v0.2.0 发布说明](docs/releases/device-debugger-v0.2.0.md)。

安卓调试中的 **Unity persistentDataPath 文件** 支持选择设备与应用、浏览标准外部目录、文本预览/下载、添加及确认替换；读取时版本与传送内容使用SHA256复核。使用步骤见[用户指南](docs/USER_GUIDE.md)，验证范围见[项目状态](docs/PROJECT_STATUS.md)。

**查看 APK 包名**：在安卓调试右侧选择电脑上的单个 APK，点击“读取包名”，再点击“复制包名”。无需手机、ADB 或 Android SDK，单文件最多 1 GiB；只读取清单，文件在操作结束或取消后清理。操作见[用户指南](docs/USER_GUIDE.md#612-查看-apk-包名)。

**多 APK 安装**：安装面板可多选完整APK，向一台或多台手机在线安装；每台按文件顺序、最多两台并行，逐“设备 + APK”反馈结果，支持精确失败重试。步骤与限制见[用户指南](docs/USER_GUIDE.md#多-apk-安装队列)。
