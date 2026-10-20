/**
 * 二维码分享模块
 *
 * 提供两类二维码：
 * 1. **页面二维码** —— 扫后跳转到当前页面（手机上看这个页面）
 * 2. **资源二维码** —— 扫后直接下载该资源的文件
 *
 * 关键问题：**手机扫码必须能访问到这台服务器**。
 * 浏览器地址栏里的 `http://127.0.0.1:5205/assets` 手机是访问不到的
 * （127.0.0.1 指的是手机自己）。所以需要一个「对外访问地址」：
 *   - 用户手动填（内网 IP / 域名）
 *   - 或从本机网卡自动推断（适合内网直连场景）
 *
 * 这个地址存在 localStorage —— 它是**部署环境相关**的，不该进数据库。
 */

/**
 * 懒加载 qrcode 库。
 *
 * 为什么要动态 import：qrcode 约 30KB（gzip 后 ~10KB），
 * 而二维码功能只在用户主动点开弹窗时才用得上。
 * 静态 import 会让它进主 chunk —— 每个页面首屏都要付这个体积。
 * 动态 import 会被 Vite 拆成独立 chunk，点开弹窗时才加载。
 */
let qrModulePromise = null;
function loadQrCode() {
    if (!qrModulePromise) {
        qrModulePromise = import('qrcode').then((m) => m.default || m);
    }
    return qrModulePromise;
}
/** localStorage key（对外访问地址） */
const ORIGIN_KEY = 'tt-share-origin';

/**
 * 读取已配置的对外访问地址。
 * @returns {string} 空字符串表示未配置
 */
export function getShareOrigin() {
    try {
        return localStorage.getItem(ORIGIN_KEY) || '';
    } catch {
        return '';
    }
}

/**
 * 保存对外访问地址。
 * @param {string} origin 形如 `http://192.168.1.10:5205`
 */
export function setShareOrigin(origin) {
    const v = String(origin || '').trim().replace(/\/+$/, '');
    try {
        if (v) localStorage.setItem(ORIGIN_KEY, v);
        else localStorage.removeItem(ORIGIN_KEY);
    } catch { /* localStorage 不可用时忽略 */ }
    return v;
}

/**
 * 推断本机的局域网地址。
 *
 * 做法：建一个到公网地址的 UDP socket（不发数据），
 * 让操作系统选出用于出站的网卡，再读出该网卡的 IPv4。
 * 这比遍历 `os.networkInterfaces()` 更准 —— 后者在有 VPN/虚拟网卡时
 * 常常返回一堆候选，用户不知道该选哪个。
 *
 * 纯浏览器做不到（拿不到网卡信息），所以这里只给一个**提示**，
 * 让用户自己填 —— 浏览器里能拿到的只有 `location.hostname`。
 *
 * @returns {Promise<string>} 推断出的地址，失败返回空串
 */
export async function detectLanAddress() {
    // 浏览器环境：只能拿到当前 hostname。
    // 若当前就是 127.0.0.1 / localhost，说明是从本机访问的，
    // 手机需要的是局域网 IP，这里给不出可靠答案 → 返回空串让用户手填。
    const host = window.location.hostname;
    if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        return `${window.location.protocol}//${window.location.host}`;
    }
    return '';
}

/**
 * 构造可分享的 URL。
 *
 * @param {string} path 站内路径（以 / 开头）
 * @param {string} [origin] 对外访问地址；不传则用已配置的，再退回当前 origin
 * @returns {string} 完整 URL
 */
export function buildShareUrl(path, origin) {
    const base = (origin !== undefined ? origin : getShareOrigin()) || window.location.origin;
    const p = String(path || '/');
    const full = p.startsWith('http') ? p : `${base.replace(/\/+$/, '')}${p.startsWith('/') ? p : '/' + p}`;
    return full;
}

/**
 * 生成二维码的 SVG 字符串。
 *
 * 用 SVG 而不是 PNG：
 *  - 矢量，任意缩放不模糊（打印/投屏都清晰）
 *  - 体积小（一段 path 而非 base64 位图）
 *  - 颜色可控，能跟随主题（深色背景下用浅色前景）
 *
 * @param {string} text 二维码内容（URL）
 * @param {object} [opts]
 * @param {string} [opts.dark] 前景色（默认纯黑）
 * @param {string} [opts.light] 背景色（默认透明）
 * @param {number} [opts.width=200] 尺寸
 * @returns {Promise<string>} SVG 字符串
 */
export async function toQrSvg(text, opts = {}) {
    const {
        dark = '#000000ff',
        light = '#00000000',
        width = 200
    } = opts;
    const QRCode = await loadQrCode();
    return QRCode.toString(String(text || ''), {
        type: 'svg',
        margin: 1,
        width,
        errorCorrectionLevel: 'M',
        color: { dark, light }
    });
}

/**
 * 资源下载 URL（扫码后手机直接下载文件）。
 *
 * 走 `?download=1` 让服务端返回 `Content-Disposition: attachment`，
 * 手机浏览器会直接触发下载而不是在标签页里打开。
 *
 * @param {number} assetId
 * @param {string} [pointer] 'latest' | 'published' | 版本号
 * @param {string} [origin] 对外访问地址
 * @returns {string}
 */
export function buildDownloadUrl(assetId, pointer = 'latest', origin) {
    const p = pointer === 'published' ? 'published'
        : pointer === 'latest' ? 'latest'
            : String(pointer);
    // 注意：/api 是 vite dev server 的代理前缀，生产环境后端直连时同路径
    const path = `/api/assets/files/${assetId}/original/${p}?download=1`;
    return buildShareUrl(path, origin);
}

/**
 * 当前页面的分享 URL。
 * @param {string} [origin]
 * @returns {string}
 */
export function buildPageUrl(origin) {
    return buildShareUrl(window.location.pathname + window.location.search, origin);
}
