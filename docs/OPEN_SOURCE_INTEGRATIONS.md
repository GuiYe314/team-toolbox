# 开源工具接入说明

TASK-034 / F-EXT-001～003。操作见 [用户指南第 9 节](USER_GUIDE.md#9-开源工具接入)，进度及验证范围只记录在 [PROJECT_STATUS](PROJECT_STATUS.md)。

## 接入方式

| 项目 | 工具箱提供 | 用户需要准备 |
|---|---|---|
| [Yoinks](https://github.com/pablostanley/yoinks) | 网页分析链接、选择清晰度 / MP3、下载进度、取消和保存；适配其 yt-dlp 核心方案 | 本机 [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases)；高清合并 / MP3 另需 [ffmpeg](https://ffmpeg.org/download.html)，可复用已有 Yoinks 的组件 |
| [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) | 本机服务配置、统一 Key 内存管理、实际模型列表、流式文本聊天、取消和原管理页入口 | 已运行的 FreeLLMAPI、统一 API Key，以及上游供应商 Key / 本地模型端点 |
| [ArtCraft](https://github.com/storytold/artcraft) | 提示词整理 / 编辑 / 复制、本机路径检测与确认启动 | 官方 Windows ArtCraft；模型、账号和素材在 ArtCraft 内配置 |

工具箱不自动运行 npm/npx、安装器或任意脚本，不捆绑三者的完整源码、二进制或模型。Yoinks 的终端 TUI 没有可直接嵌入的浏览器界面，网页共享其下载核心思路；ArtCraft 依赖 Rust/Tauri 和原生 IPC，编辑器在自身窗口运行。FreeLLMAPI 的推理与管理登录接口分开，工具箱只接入推理，供应商及路由配置在原管理页完成。界面不承诺所有模型免费或所有视频网站可用。

## 数据边界

- 接口按 Local/Lan 模式接受回环或服务器实际私网网段客户端，校验服务器 Host 和浏览器同源；写请求仍要求 JSON 与专用头，不信任代理头。
- `data/open-source-tools.json` 格式版本 1，仅保存三个可执行文件路径和 FreeLLMAPI 地址，不进 SQLite、团队备份或浏览器 localStorage。
- 统一 Key 只存后端内存；对话和提示词只在当前页。切换地址清除旧 Key，重启服务后需重填。日志仅记动作与结果，不记链接、路径、Key 或问答。
- 视频临时结果有时间和数量上限，通过同一网络来源保护接口领取，不接受任意输出目录。正常退出、取消、超时及离页清理；强制断电后的系统临时文件由系统维护。
- 本地进程使用已验证路径与服务端固定参数，不启用 Shell。ArtCraft 只返回启动请求已发送，不代表编辑器或模型就绪，不自动结束其进程。

## 上游参考与许可

- Yoinks：参考版本 0.3.1 的 `src/lib/ytdlp.ts` 中清晰度选择、MP3 参数及下载阶段。上游采用 MIT，版权及许可全文如下。
- FreeLLMAPI：依据 [REST API](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md)、[安装说明](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/install/01-install.md)；[MIT LICENSE](https://github.com/tashfeenahmed/freellmapi/blob/main/LICENSE)，Copyright (c) 2026 Tashfeen Ahmed。未复制其应用源码。
- ArtCraft：依据 [开发说明](https://github.com/storytold/artcraft/blob/main/_docs/dev_setup.md)；采用 [MIT](https://github.com/storytold/artcraft/blob/main/LICENSE-MIT) / [Apache-2.0](https://github.com/storytold/artcraft/blob/main/LICENSE-APACHE) 双许可并含 [NOTICE](https://github.com/storytold/artcraft/blob/main/NOTICE)。未复制其应用源码；未来若分发其源码或二进制，须保留适用许可及 NOTICE。
- yt-dlp、ffmpeg 由用户独立安装，许可和编译条件以下载包为准，本任务未重新分发二进制。

### Yoinks MIT License

```text
MIT License

Copyright (c) 2026 Pablo Stanley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
