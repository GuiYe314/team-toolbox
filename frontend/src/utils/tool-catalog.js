import { integrationTools } from './integration-tools.js';

// 首页、工具分组和标签共用稳定 ID；路由只能来自此内置目录。
export const TOOLS = Object.freeze([
    ...integrationTools.map(tool => ({ ...tool, status: '可用', group: 'media' })),
    { id: 'phone-album', name: '手机相册上传', desc: '手机扫码，多选照片和视频，批量保存到工具箱资源库', routeName: 'tool-phone-album', status: '可用', group: 'media' },
    { id: 'image-batch', name: '图片批处理', desc: '批量压缩、缩放、裁剪、转换格式和添加水印', routeName: 'tool-image-batch', status: '可用', group: 'media' },
    { id: 'image-ocr', name: '图片文字识别', desc: '本地中英文 OCR，从截图和照片中提取文字', routeName: 'tool-image-ocr', status: '可用', group: 'media' },
    { id: 'pdf-tools', name: 'PDF 工具', desc: '合并、提取页面、旋转、水印和图片转 PDF', routeName: 'tool-pdf', status: '可用', group: 'media' },
    { id: 'video-process', name: '视频处理', desc: '压缩、截取、转换 MP4、提取音频和视频转 GIF', routeName: 'tool-video-process', status: '可用', group: 'media' },
    { id: 'port-viewer', name: '端口查看', desc: '查看电脑 TCP / UDP 端口和占用进程，搜索端口冲突', routeName: 'tool-ports', status: '可用', group: 'network' },
    { id: 'network-speed', name: '实时网速', desc: '实时查看电脑网卡的上传、下载速度与流量趋势', routeName: 'tool-network-speed', status: '可用', group: 'network' },
    { id: 'peer-transfer', name: '手机与电脑双向互传', desc: '扫码建立浏览器连接，双向发送文件与文字', routeName: 'tool-peer-transfer', status: '可用', group: 'network' },
    { id: 'file-share', name: '局域网文件共享', desc: '共享电脑文件夹，扫码浏览目录、上传和下载文件', routeName: 'tool-file-share', status: '可用', group: 'network' },
    { id: 'remote-files', name: 'FTP 文件客户端', desc: 'FTP、FTPS、SFTP 连接，双栏文件管理与上传下载队列', routeName: 'tool-remote-files', status: '可用', group: 'network' },
    { id: 'unity-logs', name: 'Unity 设备日志', desc: '搜索局域网设备，读取与下载 Unity 历史日志', routeName: 'tool-unity-logs', status: '可用', group: 'devices' },
    { id: 'android-wireless', name: '安卓无线调试', desc: '搜索无线设备，六位码配对、连接与设备管理', routeName: 'tool-android-wireless', status: '可用', group: 'devices' },
    { id: 'android-mirror', name: '安卓流畅投屏', desc: 'scrcpy 连续画面、触控、键盘操作和设备控制', routeName: 'tool-android-mirror', status: '可用', group: 'devices' },
    { id: 'ratio-lock', name: '比例锁定', desc: '锁定宽高比，输入任一侧自动换算另一侧', routeName: 'tool-ratio-lock', status: '可用', group: 'everyday' },
    { id: 'quick-calculation', name: '快速计算', desc: '计算上下浮动区间、均匀列出数值，保存常用计算方案', routeName: 'tool-quick-calculation', status: '可用', group: 'everyday' },
    { id: 'earth-sunlight', name: '地球光照', desc: '查看当前太阳直射点、昼夜分界和太阳光方向', routeName: 'tool-earth-sunlight', status: '可用', group: 'everyday' },
    { id: 'whiteboard', name: '白板与流程图', desc: '手绘图形、文字和流程图，导出或保存到资源库', routeName: 'tool-whiteboard', status: '可用', group: 'everyday' },
    { id: 'developer-tools', name: '开发工具合集', desc: '编码、时间戳、UUID、哈希、正则、颜色及文本对比', routeName: 'tool-developer-tools', status: '可用', group: 'everyday' },
    { id: 'json-fmt', name: 'JSON 格式化', desc: 'JSON 数据的美化与压缩', routeName: 'tool-json-fmt', status: '可用', group: 'everyday' },
    { id: 'qrcode', name: '二维码生成', desc: '文本或链接快速生成二维码并下载', routeName: 'tool-qrcode', status: '可用', group: 'everyday' },
].map(Object.freeze));

export const toolByRoute = name => TOOLS.find(tool => tool.routeName === name);
