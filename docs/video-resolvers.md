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
| `backend/src/video-page.js` | 通用网页媒体提取（`video/source/og:video/iframe` 与转义地址）、HLS 主清单解析、清晰度选项生成、页面抓取大小限制 |
| `backend/src/yoinks.js` | `analyze()` 改走降级链；probe 保存解析出的媒体地址与格式；`download()` 按所选格式取实际地址 |
| `backend/src/integration-api.js` | `GET /api/integrations/yoinks/resolvers` 返回已注册方案；失败响应附带 `attempts` |
| `frontend/src/views/YoinksDownload.vue` | 统一输入框、方案清单、尝试过程、指定方案重试 |
| `data/video-resolvers.json` | **可选的**自定义方案配置，不存在则只有内置方案 |

接口仍挂在原有 `/api/integrations/yoinks/*` 下，工具 id、路由 `/tools/yoinks`、卡片数量均不变。

## 网络代理

浏览器能打开的站点，后端不一定能打开：Node 的 `fetch` 不读系统代理，yt-dlp 也只认 `--proxy`。工具箱把代理统一注入这两条链路，取值顺序是：

1. **组件设置里的「网络代理」**（写进 `data/open-source-tools.json` 的 `proxy` 字段）；
2. **Windows 系统代理**（读注册表 `HKCU\...\Internet Settings`；`reg.exe` 被安全策略禁用时改用系统命令行兜底）；只有代理端口确实在监听才采用；
3. **环境变量** `HTTPS_PROXY` / `HTTP_PROXY`（系统代理读不到或不可用时兜底）。

浏览器用的是系统代理，所以系统代理排在环境变量之前：环境变量在 Windows 上常被终端工具或 IDE 改写，容易指向一个不相关的端口。

支持 `http://` 与 `https://` 代理（抓网页 + yt-dlp 下载都生效），`socks5://` 只对 yt-dlp 下载生效（undici 的 ProxyAgent 不处理 socks）。界面「视频来源」下方会写明当前生效的代理与来源（手动设置 / 环境变量 / Windows 系统代理 / 未使用）。

## 内置方案

| id | 名称 | priority | 什么时候尝试 |
|---|---|---|---|
| `direct-media` | 直链媒体 | 10 | URL 路径以 `.mp4/.webm/.mkv/.mov/.mp3/.m4a/...` 或 `.m3u8` 结尾；做一次 HEAD 校验，跳过网页解析；m3u8 会展开成多个清晰度 |
| `p91` | 91porna 页面 | 12 | 主机是 `91porna.com` 及 `91porna<数字>.*` 镜像；HTML 里没有直链，按 `video_key` 调站内播放接口换 HLS 地址 |
| `bad-news` | bad.news 页面 | 15 | 主机是 `bad.news` 或其子域；读取话题页 HTML 里的 `data-source` 媒体地址，支持 MP4 与 HLS |
| 自定义 HTTP 方案 | 配置里命名 | 配置里给，默认 20 | 配置存在且 `domains` 匹配（未填则所有链接） |
| `ytdlp` | yt-dlp 通用解析 | 50 | 任何链接（主力兜底），列清晰度与 MP3 |
| `page-media` | 网页媒体提取 | 65 | `ytdlp` 失败后，直接抓网页 HTML 找内嵌 `video/source/og:video/iframe` 媒体地址 |
| `ytdlp-generic` | yt-dlp 通用页面 | 90 | 以上都失败后，用 `--force-generic-extractor` 再试一次 |

priority 数字越小越先尝试。类型不匹配的方案会被标为「跳过」，不消耗网络请求。

## 清晰度怎么来的

三种来源，都会在前端「清晰度 / 格式」下拉里展开：

1. **yt-dlp 列出格式**（`ytdlp`、以及 `bad-news` / `page-media` 拿到 m3u8 后）：按高度去重后给 `1080p / 720p …`，`60fps` 会标成 `1080p60`，选了就用 `-f bv*[height<=N]+ba/b[height<=N]` 合并成 MP4。
2. **HLS 主清单**（yt-dlp 读不了清单时自己解析）：读 `#EXT-X-STREAM-INF` 的 `RESOLUTION / BANDWIDTH`，给出 `1080p · 5.2 Mbps · HLS` 这样的选项，下载时仍然读同一份主清单，音轨分组能被 yt-dlp 自动合并。
3. **网页里只给单个 MP4**：显示「原始清晰度 · 直接下载」，ffmpeg 就绪时再加一项「仅音频 · MP3」。站点本身只提供一种画质时不会凭空造出更多档位，界面会明确写「该来源只提供一个清晰度」。

`bad-news` / `page-media` 解析出的地址下载时是否带 `--referer <页面地址>`，按页面自己的 Referer 策略决定：

- 页面写了 `<meta name="referrer" content="no-referrer">`（bad.news 就是这种）：一律不带 Referer。这类站点的 CDN 收到 `Referer: 站内页面` 会直接 403。
- 页面写了 `same-origin` / `origin`：只在媒体与页面同站时带。
- 页面没有声明：保持原行为，带上页面地址，兼容需要防盗链 Referer 的站点。

## bad.news 这类站点的处理方式

bad.news 没有 yt-dlp 提取器，页面把视频地址写在标签属性里：

```html
<video data-source="https://…/index.m3u8" data-type="m3u8"></video>
<video data-source="https://…/clip.mp4" data-type="mp4"></video>
```

`bad-news` 方案做三件事：把 `/ajax/download?tid=…` 之类的下载入口换回公开话题页 `/t/<id>`（避免登录要求）；抓 HTML 后用标签 + 属性正则取 `data-source`（兼容 `data-type` 写在前面、地址被 `&amp;` 或 `\/` 转义）；拿到 m3u8 就先让 yt-dlp 读格式，读不出来再自己解析主清单。

帖子页下方通常还挂着推荐视频，页面里会有多个 `data-source`。`bad-news` 会先按帖子号匹配 `data-id`（`/t/6588976` → `data-id="6588976"`），只取正文那一条；匹配不到才退回全部候选，避免规则太严导致解析不了。

同类站点如果页面结构相似，不需要改代码：`page-media`（priority 65）会对任何 `ytdlp` 解析不了的链接做同样的网页媒体提取，作为通用兜底。

## 91porna 这类站点的处理方式

这类站点的 HTML 里**没有** `<video src>`，也没有可提取的 m3u8：播放器由内联脚本 + `xgplayer` 组装，地址要拿 `video_key` 去换。链路是：

```
详情页 ?video_key=409559
  → POST {origin}/api/videos/409559/playback   （body 为 {}，带 Referer / Origin）
  → { status: 1, data: { manifest_method: "GET", streams: { main: "…m3u8?auth_key=…", hevc: "" } } }
  → 读 streams.main 清单
```

`p91` 方案做四件事：

1. 从 query 里取 `video_key`（也认 `key` / `id`，`/comic/index/embed?id=` 这种嵌入页同样能用）；取不到就报「缺 video_key」，让降级链继续。
2. POST 播放接口换地址；`streams.main` 为空时退回 `streams.hevc`，两个都空就明确报「没有可用播放地址」。
3. 读一次清单：有 `#EXT-X-STREAM-INF` 就展开多清晰度，只有 `#EXTINF` 就用 `#EXTINF` 之和算时长（省掉一次 yt-dlp 探测），给「原始清晰度 · HLS」，ffmpeg 就绪时再给「仅音频 · MP3」。
4. 每个选项都带上 `url`，下载与「先看看」预览都直连这份清单，不再经过网页。

两个实测结论：清单通常是 **AES-128 加密**（`#EXT-X-KEY:METHOD=AES-128`）的单码率流，yt-dlp 会自己取 `crypt.key` 解密再合并成 MP4，不需要额外参数；分片和密钥都**不需要** `x-cdn-auth` 头，页面 `cdn-config` 里那个值只有个别 CDN 开关才用得上。

`auth_key` 里带过期时间（约 2 小时），所以解析结果要在 5 分钟票据内用掉；超时后重新解析即可。

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
- 下载阶段不再限制单文件体积与总时长：按 `url + 清晰度` 建立稳定的缓存目录并用 `--continue` 续传，超过五分钟没有字节进展才由看门狗暂停。解析层不改变这些约束。

## 调试建议

1. 页面「解析方案」区直接看每个方案的状态与耗时。
2. 想验证某个方案是否可用，在下拉里指定它，再点「解析链接」。
3. 自定义服务没出现：检查 `data/video-resolvers.json` 是否为合法 JSON、`version` 是否为 `1`、`id` 是否重复、`enabled` 是否被设为 `false`。
4. `direct-media` 的 HEAD 返回 403 / 405 / 501 时不算失败（防盗链或服务端不支持 HEAD），真正的可用性在下载阶段验证。
