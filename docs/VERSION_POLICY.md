# 设备调试工具版本与发布

本文件只约束codex/device-debugger，完整工具箱的历史说明留在Git历史和历史发布文档。状态唯一来源为PROJECT_STATUS。

- 产品device-debugger，版本0.y.z，当前源码版本单一来源backend/package.json；frontend与两锁文件必须同步，构建脚本派生安装器/清单/资产版本。
- 正式标签device-debugger-v<版本>；分支codex/device-debugger。不合并裁剪提交到main。
- 四份资产：device-debugger-Setup-<版本>.exe、device-debugger-<版本>.zip、device-debugger-<版本>-SHA256.txt、device-debugger-manifest.json。清单记录本产品与ZIP/EXE大小、SHA256和精确标签下载地址。没有主工具箱manifest.json。
- Release为正式非预发布，必须make_latest=false；原工具箱latest不得改变。独立产品暂无自动更新，请关闭服务、备份data/后手动下载本产品新版。
- 独立Inno AppId DD7438A4-6E96-4CD6-91F8-BC03D4939A12，默认安装到%LOCALAPPDATA%/device-debugger，使用3100端口，不能覆盖team-toolbox目录。卸载保留data/与日志，不自动复制旧配置。
- 发布只打包两模块白名单、前端dist、完整生产依赖和内置Node22.22.2及许可。没有数据库或原生ABI依赖。不能包含真实数据、.env、测试、开发依赖或构建缓存。
- 发布前执行后端完整测试、前端构建、安卓/文件管理/独立Unity浏览器回归、Local/Lan和Windows启动验收；在全新目录解压验证实际启动/停止、深链、两API与数据保留；安装器另在随机目录静默安装及卸载。Node22/24依赖加载均需验证。真机限制明确记录。
- 推送分支与版本标签后先草稿上传，核对四份资产再正式发布；核对远端commit/大小/digest与原主线latest。发布结果另作文档提交，不移动已经发布的标签。
