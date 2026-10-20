// 统一预览系统 —— Provider 注册表 + 生命周期管理。
//
// 设计目标（用户明确要求）：
//   业务代码里不允许出现 `if (jpg) ... else if (mp4) ...`。
//   统一调用 PreviewManager.open(asset, version)，由它按类型选 Provider。
//   以后把 model-viewer 换成 Three.js，只需换 Provider 实现，
//   调用方一行不改。
//
// 生命周期纪律（用户明确要求「Preview 切换时释放旧资源」）：
//   每个 Provider 声明自己怎么创建、怎么销毁。切换/关闭时
//   PreviewManager 保证先 destroy 旧的，再 create 新的 ——
//   Video 必须 pause、Audio 必须 stop、Monaco 必须 dispose、
//   model-viewer 必须从 DOM 摘除。这些都封装在各自 Provider 内，
//   PreviewManager 只管调用契约。
//
// 第三方依赖一律**懒加载**：model-viewer / pdf.js / monaco / wavesurfer
// 体积大且用得少，动态 import 才能让首屏 bundle 不被拖垮。

import { hasPreviewProvider } from './asset-meta.js';

/**
 * Provider 契约：
 *   { id, canHandle(asset, version), async mount(container, ctx), destroy() }
 *
 *   mount 返回可选的清理函数，destroy() 由 PreviewManager 调用。
 *   ctx = { asset, version, fileUrl, kind, signal }
 *     kind: 'original' | 'preview' —— 优先用 preview，缺失时回退 original
 */

class PreviewManager {
    constructor() {
        /** @type {Map<string, object>} id → provider 实例原型 */
        this._factories = new Map();
        /** 当前激活的 provider 实例 */
        this._active = null;
        /** 当前激活的容器（用于判断是否需要释放） */
        this._activeEl = null;
    }

    /**
     * 注册 Provider。
     * @param {object} factory Provider 工厂，返回实例或实例本身
     */
    register(factory) {
        if (!factory || !factory.id) throw new Error('Provider 必须有 id');
        this._factories.set(factory.id, factory);
        return this;
    }

    /**
     * 选出第一个能处理该资产的 Provider。
     * 注册顺序即优先级：具体类型在前，兜底（unsupported）在后。
     */
    resolve(asset, version) {
        for (const factory of this._factories.values()) {
            try {
                if (factory.canHandle && factory.canHandle(asset, version)) return factory;
            } catch {
                // Provider 的判定出错不应中断整条链，继续试下一个
            }
        }
        return this._factories.get('unsupported') || null;
    }

    /**
     * 打开预览。
     *
     * @param {HTMLElement} container 挂载容器（调用方负责清空内部内容）
     * @param {object} asset
     * @param {object} version
     * @param {object} ctx { fileUrl, kind, signal }
     * @returns {Promise<{ ok: boolean, error?: string, providerId?: string }>}
     */
    async open(container, asset, version, ctx = {}) {
        // 串行化：open 是异步的，若上一次 open 还在 await（拉文件 / 加载组件），
        // 第二次调用会与它并发 —— 两次都通过 innerHTML='' 这道清理，
        // 随后各自 append，结果容器里出现**两份**预览内容。
        // 用一个链式 Promise 把所有 open 排成队列，杜绝竞态。
        this._chain = (this._chain || Promise.resolve())
            .catch(() => {})            // 上一次失败不阻断本次
            .then(() => this._doOpen(container, asset, version, ctx));
        return this._chain;
    }

    async _doOpen(container, asset, version, ctx = {}) {
        // 关键：先释放上一个 Provider，否则 Video/Audio 会继续播、
        // model-viewer 会继续占用 WebGL 上下文、Monaco 会泄漏 worker。
        this.close();

        const factory = this.resolve(asset, version);
        if (!factory) {
            return { ok: false, error: '没有可用的预览器' };
        }

        try {
            const provider = typeof factory.create === 'function' ? await factory.create() : factory;
            container.innerHTML = '';
            const handle = await provider.mount(container, { asset, version, ...ctx });
            this._active = provider;
            this._activeEl = container;
            this._activeHandle = handle;
            return { ok: true, providerId: factory.id };
        } catch (err) {
            // 预览失败**不隐藏**，把原因渲染到容器里给用户看
            const msg = (err && err.message) || '预览加载失败';
            container.innerHTML = '';
            const box = document.createElement('div');
            box.className = 'pv-error';
            box.textContent = `无法预览：${msg}`;
            container.appendChild(box);
            this._active = null;
            this._activeEl = null;
            return { ok: false, error: msg, providerId: factory.id };
        }
    }

    /**
     * 释放当前预览。幂等 —— 重复调用安全。
     * 每个 Provider 的 destroy 必须自行保证可重复调用。
     */
    close() {
        if (this._active) {
            try {
                if (typeof this._active.destroy === 'function') this._active.destroy();
            } catch {
                // 释放失败不应阻断后续流程
            }
        }
        if (typeof this._activeHandle === 'function') {
            try { this._activeHandle(); } catch { /* 同上 */ }
        }
        this._active = null;
        this._activeEl = null;
        this._activeHandle = null;
    }

    /** 当前激活的 provider id（调试用）。 */
    get activeId() {
        return this._active ? this._active.constructor.id || 'unknown' : null;
    }
}

// ══════════════════════════════════════════════════════════════════
// Provider 实现
// 每个 Provider 只关心「怎么渲染自己的类型」与「怎么干净地拆掉自己」，
// 不认识其他类型，也不认识 AssetPreviewManager。
// ══════════════════════════════════════════════════════════════════

/**
 * 图片预览。
 * 不引 PhotoSwipe：它要求接管一整组 <img> 的 DOM 结构，
 * 而这里要精确控制「预览图 ↔ 原图」的 URL 切换与缩放基准，
 * 自实现灯箱反而更直接（约 150 行，见 PreviewDialog）。
 * 本 Provider 只负责把图片放进容器并保证 URL 释放。
 */
export const ImagePreviewProvider = {
    id: 'image',
    canHandle: (asset) => asset?.type === 'image',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const img = document.createElement('img');
        img.src = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        img.alt = asset.name;
        img.className = 'pv-image';
        // 加载失败要有明确反馈，不能留一片空白
        img.addEventListener('error', () => {
            img.remove();
            const box = document.createElement('div');
            box.className = 'pv-error';
            box.textContent = '图片加载失败，文件可能已被清理';
            container.appendChild(box);
        });
        img.addEventListener('load', () => container.appendChild(img));
        // 返回清理函数：显式置空 src 触发浏览器释放解码资源
        return () => { img.src = ''; img.remove(); };
    },
    destroy() { /* 由 mount 返回的清理函数处理 */ }
};

/**
 * 视频预览。
 * 用原生 <video> 而非 Video.js：原生已支持播放/暂停/时间轴/音量/倍速，
 * 全屏与画中画是浏览器内置能力。引 Video.js 仅为这几个功能不划算，
 * 反而多一套皮肤要跟主题对齐。
 * HLS（.m3u8）后续接入时在此处替换为 hls.js 即可，调用方无感。
 */
export const VideoPreviewProvider = {
    id: 'video',
    canHandle: (asset) => asset?.type === 'video',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const video = document.createElement('video');
        video.className = 'pv-video';
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        // 倍速：浏览器支持则开放选择
        video.src = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        container.appendChild(video);

        const onErr = () => {
            video.remove();
            const box = document.createElement('div');
            box.className = 'pv-error';
            box.textContent = '视频加载失败，浏览器可能不支持该编码';
            container.appendChild(box);
        };
        video.addEventListener('error', onErr);

        return () => {
            // 关键：离开预览必须暂停并清空 src，
            // 否则后台继续解码、继续出声
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.removeEventListener('error', onErr);
        };
    },
    destroy() { }
};

/**
 * 音频预览。
 * 用原生 <audio> + Web Audio 画静态波形。
 * 波形用 AnalyserNode 实时绘制：不需要额外库，
 * 且 WaveSurfer 引入后要处理它自己的 DOM 与 resize 生命周期。
 */
export const AudioPreviewProvider = {
    id: 'audio',
    canHandle: (asset) => asset?.type === 'audio',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const audio = document.createElement('audio');
        audio.className = 'pv-audio';
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        container.appendChild(audio);

        // 波形画布：AudioContext 只在用户交互后才能启动，
        // 故先画静态占位，播放时再接 AnalyserNode 实时绘制
        const canvas = document.createElement('canvas');
        canvas.className = 'pv-wave';
        canvas.width = 800;
        canvas.height = 120;
        container.appendChild(canvas);
        const c2d = canvas.getContext('2d');
        c2d.strokeStyle = getComputedStyle(container).color;
        c2d.globalAlpha = 0.28;
        c2d.beginPath();
        c2d.moveTo(0, canvas.height / 2);
        c2d.lineTo(canvas.width, canvas.height / 2);
        c2d.stroke();
        c2d.globalAlpha = 1;

        let audioCtx = null;
        let analyser = null;
        let raf = 0;

        const drawWave = () => {
            if (!analyser) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(data);
            c2d.clearRect(0, 0, canvas.width, canvas.height);
            c2d.lineWidth = 1.5;
            c2d.beginPath();
            const step = canvas.width / data.length;
            for (let i = 0; i < data.length; i++) {
                const v = data[i] / 128.0;
                const y = (v * canvas.height) / 2;
                if (i === 0) c2d.moveTo(0, y);
                else c2d.lineTo(i * step, y);
            }
            c2d.stroke();
            raf = requestAnimationFrame(drawWave);
        };

        const onPlay = () => {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const src = audioCtx.createMediaElementSource(audio);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;
                src.connect(analyser);
                analyser.connect(audioCtx.destination);
                drawWave();
            } catch {
                // 不支持时保留静态波形，不影响播放
            }
        };

        audio.addEventListener('play', onPlay, { once: true });

        return () => {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            cancelAnimationFrame(raf);
            audio.removeEventListener('play', onPlay);
            if (audioCtx) audioCtx.close().catch(() => {});
            audioCtx = null;
            analyser = null;
        };
    },
    destroy() { }
};

/**
 * 3D 模型预览（重点功能）。
 *
 * GLB / GLTF 用 model-viewer：它是 Web Component，Vue 里只需
 * customElements.define 后当普通标签用，无需框架适配。
 *
 * FBX / OBJ / STL **不在浏览器直接解析源文件**（用户明确要求）：
 * 大型 FBX 动辄数百 MB，浏览器解析会卡死主线程且格式复杂。
 * 正确路径是服务端 PreviewProcessor 转成 preview.glb，网页只加载它。
 * 所以这里：若有 preview.glb 就用它；否则明确提示「预览未生成，请下载原文件」，
 * 而不是让浏览器去啃 FBX。
 */
export const ModelPreviewProvider = {
    id: 'model',
    canHandle: (asset) => asset?.type === 'model',
    async mount(container, ctx) {
        const { asset, version, fileUrl, previewUrl } = ctx;

        // 优先用服务端生成的 preview.glb；没有则不硬啃源文件
        const src = previewUrl || fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        const isConverted = !!previewUrl;
        const isGltfLike = /\.(glb|gltf)$/i.test(asset.name || '');

        if (!isConverted && !isGltfLike) {
            const box = document.createElement('div');
            box.className = 'pv-note';
            // 不是甩锅式报错，而是说清原因与替代路径
            box.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = `${(asset.name || '该模型').split('.').pop().toUpperCase()} 需要服务端转码后才能在网页预览。`;
            const hint = document.createElement('p');
            hint.className = 'am-hint';
            hint.textContent = '服务端 PreviewProcessor 生成 preview.glb 后即可直接预览；当前可下载原文件。';
            box.appendChild(p);
            box.appendChild(hint);
            container.appendChild(box);
            return () => box.remove();
        }

        await ensureModelViewer();
        const mv = document.createElement('model-viewer');
        mv.className = 'pv-model';
        mv.setAttribute('src', src);
        mv.setAttribute('alt', asset.name || '3D 模型');
        mv.setAttribute('camera-controls', '');
        mv.setAttribute('auto-rotate', '');
        mv.setAttribute('shadow-intensity', '1');
        // 曝光度交给主题：深色背景下模型不至于黑成一团
        mv.setAttribute('exposure', '1.1');
        mv.style.width = '100%';
        mv.style.height = '100%';
        container.appendChild(mv);

        // model-viewer 加载失败（文件损坏 / 不是真 GLB / 网络中断）会派发 error 事件。
        // 不处理的话，错误只会出现在控制台，用户看到的是一个空白的黑框 ——
        // 必须显式捕获并给出说明。
        const onError = () => {
            mv.remove();
            const box = document.createElement('div');
            box.className = 'pv-error';
            box.textContent = '模型加载失败：文件可能已损坏或不是有效的 GLB。';
            container.appendChild(box);
        };
        mv.addEventListener('error', onError);

        return () => {
            mv.removeEventListener('error', onError);
            mv.remove();
        };
    },
    destroy() { }
};

/** 懒加载 model-viewer，只注册一次。 */
let modelViewerPromise = null;
export function ensureModelViewer() {
    if (modelViewerPromise) return modelViewerPromise;
    modelViewerPromise = import('@google/model-viewer')
        .then(() => {
            // Web Component 注册后即可当普通元素用
            if (!customElements.get('model-viewer')) {
                // 某些打包配置下 import 只返回 side effect，此处再兜一次
                return import('@google/model-viewer/dist/model-viewer.min.js');
            }
        })
        .catch((err) => {
            throw new Error('3D 预览组件加载失败，请检查网络或改用其他预览方式');
        });
    return modelViewerPromise;
}

/**
 * PDF 预览。
 * 懒加载 pdf.js。用 canvas 渲染，不引 PDFViewer（它的 DOM 树太重，
 * 且自带工具栏会与本项目主题冲突）。
 */
export const PdfPreviewProvider = {
    id: 'pdf',
    canHandle: (asset) => asset?.type === 'pdf',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const pdfjs = await loadPdfJs();
        const url = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        const doc = await pdfjs.getDocument(url).promise;

        const wrap = document.createElement('div');
        wrap.className = 'pv-pdf';
        const canvas = document.createElement('canvas');
        canvas.className = 'pv-pdf-canvas';
        wrap.appendChild(canvas);
        container.appendChild(wrap);

        let scale = 1.2;
        let renderTask = null;

        const render = async (pageNum) => {
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            const dpr = window.devicePixelRatio || 1;
            canvas.width = viewport.width * dpr;
            canvas.height = viewport.height * dpr;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            const c2d = canvas.getContext('2d');
            c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            // 翻页/缩放时必须先取消上一次渲染，否则两个任务争同一 canvas
            if (renderTask) {
                try { renderTask.cancel(); } catch { /* 已完成 */ }
            }
            renderTask = page.render({ canvasContext: c2d, viewport });
            try { await renderTask.promise; } catch (e) {
                if (e && e.name !== 'RenderingCancelledException') throw e;
            }
        };

        await render(1);

        // 简易翻页控件：pdf.js 完整 Viewer 体积太大且样式难统一
        const bar = document.createElement('div');
        bar.className = 'pv-pdf-bar';
        const prev = document.createElement('button');
        prev.className = 'btn btn-sm';
        prev.textContent = '上一页';
        const next = document.createElement('button');
        next.className = 'btn btn-sm';
        next.textContent = '下一页';
        const label = document.createElement('span');
        label.className = 'am-hint';
        const zin = document.createElement('button');
        zin.className = 'btn btn-sm';
        zin.textContent = '放大';
        const zout = document.createElement('button');
        zout.className = 'btn btn-sm';
        zout.textContent = '缩小';

        let page = 1;
        const update = async () => {
            label.textContent = `${page} / ${doc.numPages}`;
            prev.disabled = page <= 1;
            next.disabled = page >= doc.numPages;
            await render(page);
        };
        prev.onclick = () => { page--; update(); };
        next.onclick = () => { page++; update(); };
        zin.onclick = () => { scale = Math.min(3, scale + 0.25); update(); };
        zout.onclick = () => { scale = Math.max(0.4, scale - 0.25); update(); };
        bar.append(prev, label, next, zin, zout);
        container.appendChild(bar);
        update();

        return () => {
            if (renderTask) {
                try { renderTask.cancel(); } catch { /* 已完成 */ }
            }
            doc.destroy();
            wrap.remove();
            bar.remove();
        };
    },
    destroy() { }
};

let pdfJsPromise = null;
function loadPdfJs() {
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = import('pdfjs-dist')
        .then((mod) => {
            const lib = mod.default || mod;
            if (lib.GlobalWorkerOptions) {
                lib.GlobalWorkerOptions.workerSrc = new URL(
                    'pdfjs-dist/build/pdf.worker.min.mjs',
                    import.meta.url
                ).toString();
            }
            return lib;
        })
        .catch(() => {
            throw new Error('PDF 预览组件加载失败');
        });
    return pdfJsPromise;
}

/**
 * Markdown 预览。
 *
 * 不引 Vditor（试过，不合适）：它是**编辑器**，只读预览时它仍会同时
 * 渲染 ir（渲染态）与 sv（源码态）两套 DOM，表现为「同一份内容出现两遍」；
 * 而且 lute 内核有 3.7MB，为看一眼文档付出这个代价不划算。
 *
 * 改为复用项目既有的后端渲染接口 POST /api/markdown/render
 * （marked + sanitize-html 白名单，与知识库阅读页完全一致）。
 * 好处：① 零新增依赖；② 阅读页与预览页渲染结果必然一致，
 * 不存在「编辑器里好看、阅读页走样」的分裂。
 */
export const MarkdownPreviewProvider = {
    id: 'markdown',
    canHandle: (asset) => asset?.type === 'markdown',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const url = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`文件读取失败（${res.status}）`);
        const md = await res.text();

        const render = await fetch('/api/markdown/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ md })
        });
        if (!render.ok) throw new Error('Markdown 渲染失败');
        const html = (await render.json()).html || '';

        const box = document.createElement('article');
        box.className = 'markdown-body pv-md';
        box.innerHTML = html;
        container.appendChild(box);

        return () => box.remove();
    },
    destroy() { }
};

/**
 * 文本 / 代码预览。
 * 懒加载 Monaco。JSON 自动格式化（用户要求）。
 * 若 Monaco 加载失败，降级为 <pre> 纯文本 —— 预览失败不该让用户完全看不到内容。
 */
export const TextPreviewProvider = {
    id: 'text',
    canHandle: (asset) => asset?.type === 'text',
    async mount(container, ctx) {
        const { asset, version, fileUrl } = ctx;
        const url = fileUrl(asset.id, 'original', version?.versionNumber || 'latest');
        let text = await fetch(url).then((r) => r.text());

        // JSON 自动格式化：缩进 2 空格；解析失败则原样显示，不吞错误
        if (/\.json$/i.test(asset.name || '')) {
            try {
                text = JSON.stringify(JSON.parse(text), null, 2);
            } catch (e) {
                const warn = document.createElement('div');
                warn.className = 'pv-note';
                warn.textContent = `JSON 格式化失败（${e.message}），以下为原始内容`;
                container.appendChild(warn);
            }
        }

        let editor = null;
        try {
            const monaco = await loadMonaco();
            editor = monaco.editor.create(container, {
                value: text,
                language: detectLanguage(asset.name),
                readOnly: true,
                theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs',
                minimap: { enabled: false },
                fontSize: 12.5,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on'
            });
        } catch {
            // 降级：至少让内容可见
            const pre = document.createElement('pre');
            pre.className = 'pv-plain';
            pre.textContent = text;
            container.appendChild(pre);
        }

        return () => {
            if (editor) {
                // Monaco 不 dispose 会泄漏其 worker 与 DOM 观察器
                editor.dispose();
                editor = null;
            }
        };
    },
    destroy() { }
};

/** 扩展名 → Monaco 语言 id。 */
function detectLanguage(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = {
        json: 'json', xml: 'xml', html: 'html', css: 'css',
        js: 'javascript', mjs: 'javascript', ts: 'typescript', cs: 'csharp',
        yaml: 'yaml', yml: 'yaml', ini: 'ini', txt: 'plaintext', md: 'markdown'
    };
    return map[ext] || 'plaintext';
}

let monacoPromise = null;
function loadMonaco() {
    if (monacoPromise) return monacoPromise;
    monacoPromise = import('monaco-editor')
        .then((mod) => mod.default || mod)
        .catch(() => {
            throw new Error('代码编辑器加载失败');
        });
    return monacoPromise;
}

/**
 * 兜底：没有匹配到 Provider，或该类型确实无预览能力。
 * 必须给出明确原因与替代路径，而不是空白页。
 */
export const UnsupportedPreviewProvider = {
    id: 'unsupported',
    canHandle: () => true,
    async mount(container, ctx) {
        const { asset } = ctx;
        const box = document.createElement('div');
        box.className = 'pv-note';

        const title = document.createElement('p');
        if (!hasPreviewProvider(asset?.type)) {
            title.textContent = `「${asset?.type || '未知'}」类型暂不支持浏览器内预览。`;
        } else {
            title.textContent = '该版本没有可用的预览文件。';
        }
        const hint = document.createElement('p');
        hint.className = 'am-hint';
        hint.textContent = '可以下载原文件查看，或等待服务端生成预览。';
        box.append(title, hint);
        container.appendChild(box);
        return () => box.remove();
    },
    destroy() { }
};

// ══════════════════════════════════════════════════════════════════
// 默认实例
// ══════════════════════════════════════════════════════════════════

/** 全局单例。预览弹窗与详情页共用一个，避免两处各自初始化。 */
export const previewManager = new PreviewManager()
    .register(ImagePreviewProvider)
    .register(VideoPreviewProvider)
    .register(AudioPreviewProvider)
    .register(ModelPreviewProvider)
    .register(PdfPreviewProvider)
    .register(MarkdownPreviewProvider)
    .register(TextPreviewProvider)
    .register(UnsupportedPreviewProvider);

export default previewManager;