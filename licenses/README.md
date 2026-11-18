# 本地工具组件来源

本目录保留新增工具直接使用的库许可原文，版本以锁文件为准：

- FTP客户端：basic-ftp、ssh2及新增传递依赖的许可原文汇总于`remote-files-LICENSES.txt`，包含MIT、BSD-3-Clause、Unlicense及可选原生优化包许可。发布脚本复制整个licenses目录；FileZilla仅作布局参考，不包含其程序源码。

- Sharp、Tesseract.js、Tesseract.js Core、scrcpy：Apache-2.0。
- pdf-lib、Excalidraw、Monaco Editor、React、React DOM、@noble/hashes：MIT。
- Excalidraw 的字体从 `@excalidraw/excalidraw@0.18.1/dist/prod/fonts` 原样复制，来源为 <https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts>，保留字体文件内的版权及许可信息，不修改字体。
- Tesseract 中英文模型由 `@tesseract.js-data/eng`、`@tesseract.js-data/chi_sim` 分发，来源为 <https://github.com/naptha/tessdata>，底层模型沿用 Tesseract 数据许可。
- FFmpeg 沿用 `vendor/media/win32-x64` 中原有许可与来源记录。

双向互传和开发工具是本项目实现；PairDrop、IT-Tools 仅为功能参考，未复制其应用源码。scrcpy 下载来源、大小和 SHA-256 记录在 `scripts/scrcpy.lock.json`；发布构建带入本目录和组件许可。
