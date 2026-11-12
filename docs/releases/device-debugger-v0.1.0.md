# 设备调试工具 0.1.0

将安卓无线调试与Unity设备日志合成独立Windows网页工具，默认端口3100，可与完整工具箱并存。独立安装目录、配置和标签，不影响完整工具箱自动更新。

- 安卓扫码/六位码配对、连接管理、六项常用与自定义ADB命令、单台/多机APK安装、单应用Logcat、手机屏幕刷新。
- 新增Unity persistentDataPath文件管理：设备/包名选择、当前Android用户标准外部目录、子目录浏览、UTF-8预览/下载、添加与确认替换，文件变化检测与SHA256传送校验。
- Unity局域网日志：专用协议搜索、历史文件、级别/关键词/堆栈、复制、全文与ZIP下载。
- 内置Node、Windows安装包和便携包，生产依赖不含SQLite/图形原生模块；无知识库/资源库/模型等功能。

首次运行双击启动.cmd，关闭用关闭.cmd。ADB需另行准备Platform-Tools。Unity日志需设备App运行兼容的Assets/Test/Log模块。

本版用于可信本机或局域网，无账户权限。persistentDataPath仅支持标准Android/data/包名/files，厂商可能限制ADB访问；替换前建议关闭App并下载备份，取消不能撤销已经提交的写入。

验证使用临时配置、离线ADB/合成文件、真实无头浏览器和合成Unity HTTP服务；真实手机/平板、另一物理客户端与厂商权限兼容性未验收。详细证据见docs/PROJECT_STATUS.md及独立封版记录。

只下载device-debugger前缀资产；本发布不是完整工具箱latest，不可覆盖完整工具箱安装目录。
