# 视频下载 · 统一链接解析与解析方案扩展

## 它解决什么

以前「视频下载」只有一条 yt-dlp 探测路径：能解析就出清晰度，不能解析就直接报错。现在所有链接都走**同一个解析入口**，后端按优先级依次尝试若干「解析方案」（resolver）：

```
粘贴链接 → 校验 URL → 按 priority 排序 → 跳过类型不匹配的方案
        → 方案 A 尝试 → 失败 → 方案 B 尝试 → 失败 → 方案 C …
        → 任一成功即停止，返回「由哪个方案解析成功」+ 每个方案的尝试结果
        → 全部失败才报错，并附上每个方案的失败原因
```

前端会列出尝试过程（成功 / 失败 / 跳过 / 耗时），也可以指定「只用某一个方案重试」。

## 相关文件

| 文件 | 作用 |
|---|---|
| `backend/src/video-resolvers.js` | 方案注册表、降级链 `resolveVideo()`、内置方案、自定义配置加载与代码级注册入口 |
| `backend/src/yoinks.js` | `analyze()` 改走降级链；probe 保存解析出的媒体地址与格式；`download()` 按所选格式取实际地址 |
| `backend/src/integration-api.js` | `GET /api/integrations/yoinks/resolvers` 返回已注册方案；失败响应附带 `attempts` |
| `frontend/src/views/YoinksDownload.vue` | 统一输入框、方案清单、尝试过程、指定方案重试 |
| `data/video-resolvers.json` | **可选的**自定义方案配置，不存在则只有内置方案 |

接口仍挂在原有 `/api/integrations/yoinks/*` 下，工具 id、路由 `/tools/yoinks`、卡片数量均不变。

## 内置方案

| id | 名称 | priority | 什么时候尝试 |
|---|---|---|---|
| `direct-media` | 直链媒体 | 10 | URL 路径以 `.mp4/.webm/.mkv/.mov/.mp3/.m4a/...` 结尾；做一次 HEAD 校验，跳过网页解析 |
| 自定义 HTTP 方案 | 配置里命名 | 配置里给，默认 20 | 配置存在且 `domains` 匹配（未填则所有链接） |
| `ytdlp` | yt-dlp 通用解析 | 50 | 任何链接（主力兜底），列清晰度与 MP3 |
| `ytdlp-generic` | yt-dlp 通用页面 | 90 | `ytdlp` 失败后，用 `--force-generic-extractor` 再试一次 |

priority 数字越小越先尝试。类型不匹配的方案会被标为「跳过」，不消耗网络请求。

## 方式一：不改代码，配置自定义解析服务

在工具箱**安装目录的 `data/` 下**新建 `video-resolvers.json`（与 `open-source-tools.json` 同级）。文件不存在或格式写坏时静默忽略，不影响内置方案。

```json
{
  "version": 1,
  "resolvers": [
    {
      "id": "my-parser",
      "name": "我的解析服务",
      "endpoint": "http://127.0.0.1:8899/resolve",
      "headers": { "X-Token": "local-secret" },
      "domains": ["example.com"],
      "priority": 20,
      "timeoutMs": 12000,
      "enabled": true
    },
    {
      "id": "another-parser",
      "name": "备用解析服务",
      "endpoint": "https://parser.example.com/api/resolve",
      "priority": 25
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 小写字母/数字/连字符，最长 40 字符，不能与内置或其它方案重复 |
| `name` | 否 | 界面显示名，默认用 id |
| `endpoint` | 是 | 只接受 http/https，不能带账号密码；允许本机回环地址 |
| `headers` | 否 | 最多 12 个自定义请求头，键值对均为字符串 |
| `domains` | 否 | 只对匹配的域名尝试，支持后缀匹配；不填则所有链接都尝试 |
| `priority` | 否 | 1–99，默认 20 |
| `timeoutMs` | 否 | 3000–30000，默认 12000 |
| `enabled` | 否 | 设为 `false` 即临时停用，不用删配置 |

最多读取 32 条配置。改完文件**不用重启**，下次点「解析链接」就会重新读取。

### 你的解析服务要返回什么

工具箱会 `POST` 到 endpoint：

```json
{ "url": "https://example.com/watch?v=xxx" }
```

返回 JSON，最简形式只给一个可下载直链：

```json
{ "title": "示例视频", "url": "https://cdn.example.com/video.mp4" }
```

也可以给多个清晰度，前端会把它们列成下载格式：

```json
{
  "title": "示例视频",
  "uploader": "作者",
  "duration": 183,
  "url": "https://cdn.example.com/720p.mp4",
  "formats": [
    { "id": "1080p", "label": "1080p · MP4", "url": "https://cdn.example.com/1080p.mp4" },
    { "id": "720p", "label": "720p · MP4", "url": "https://cdn.example.com/720p.mp4" }
  ]
}
```

`formats[].url` 会成为该格式实际下载的地址；不填 `url` 时回退到顶层 `url`，再回退到用户粘贴的原始链接。最多 12 个格式。

**注意**：解析服务返回的任何地址都会再过一遍和用户输入相同的 URL 白名单校验（必须是公开 http/https，拒绝内网、回环、`localhost`、带账号密码的地址），校验不通过就当作该方案失败，自动换下一个。`formats` 里不能下发 yt-dlp 参数，避免命令行注入；下载与合并参数始终由工具箱生成。

## 方式二：代码级扩展

如果解析方案需要本地计算、读文件或调用私有 SDK，可以写一个 resolver 对象注册进去：

```js
import { registerResolver } from './video-resolvers.js';

registerResolver({
    id: 'my-native-parser',
    name: '本地专用解析',
    description: '处理某站点的自有格式',
    priority: 15,
    match: url => new URL(url).hostname.endsWith('example.com'),
    async resolve(url, ctx) {
        // ctx: { runner, tools, signal, commonArgs, runtimeArgs,
        //        videoChoices, validateUrl, childSignal(ms), now, forcedResolverId }
        const mediaUrl = doMyOwnParsing(url);
        return {
            title: '解析结果',
            uploader: '',
            duration: null,
            mediaUrl,
            choices: [{ id: 'best', label: '最佳画质', args: [] }],
            ffmpegReady: !!ctx.tools.ffmpegPath
        };
    }
});
```

`resolve()` 抛出任何错误，或返回空/无效的 `choices`，都会被记为「失败」并自动降级到下一个方案。`registerResolver()` 返回一个反注册函数。

## 降级与失败的语义

- **成功**：立即停止，返回 `{ resolvedBy, attempts, title, choices, ... }`，前端高亮成功方案。
- **失败**：记录方案名、简短原因、耗时；原因只来自工具箱自己的错误文案，不暴露 yt-dlp 的 stderr 或上游返回内容。
- **跳过**：`match()` 判定链接类型不匹配，不发网络请求。
- **全部失败**：返回 HTTP 502，`message` 概括尝试数量，响应里带 `attempts` 数组；前端把它渲染成方案日志。
- **手动指定**：`POST /yoinks/analyze` 可带 `resolverId`，此时只跑这一个方案，跳过其它所有方案。
- 下载阶段仍复用原有的大小上限（1 GiB）、15 分钟超时、临时目录与文件校验；解析层不改变这些安全约束。

## 调试建议

1. 页面「解析方案」区直接看每个方案的状态与耗时。
2. 想验证某个方案是否可用，在下拉里指定它，再点「解析链接」。
3. 自定义服务没出现：检查 `data/video-resolvers.json` 是否为合法 JSON、`version` 是否为 `1`、`id` 是否重复、`enabled` 是否被设为 `false`。
4. `direct-media` 的 HEAD 返回 403 / 405 / 501 时不算失败（防盗链或服务端不支持 HEAD），真正的可用性在下载阶段验证。
