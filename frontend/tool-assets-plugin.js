import { cpSync, mkdirSync, readdirSync, existsSync, createReadStream } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';

// 固定安装包资源在开发/生产都走同源；不从 CDN 加载 worker、模型或白板字体。
export function toolAssets() {
    let root, out;
    function inventory() {
        const files = [];
        const add = (source, target) => { if (!existsSync(source)) throw new Error(`本地工具资源缺失：${target}`); files.push([source, '/vendor/tools/' + target]); };
        add(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), 'ocr/worker.min.js');
        const core = join(root, 'node_modules/tesseract.js-core');
        for (const file of readdirSync(core)) if (/^tesseract-core(?:-(?:simd|relaxedsimd))?(?:-lstm)?\.wasm(?:\.js)?$/.test(file)) add(join(core, file), 'ocr/core/' + file);
        for (const language of ['eng', 'chi_sim']) add(join(root, `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`), 'ocr/lang/' + language + '.traineddata.gz');
        const fonts = join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
        function walk(directory, prefix) { for (const entry of readdirSync(directory, { withFileTypes: true })) entry.isDirectory() ? walk(join(directory, entry.name), prefix + entry.name + '/') : add(join(directory, entry.name), prefix + entry.name); }
        if (existsSync(fonts)) walk(fonts, 'whiteboard/fonts/');
        return files;
    }
    return {
        name: 'local-tool-assets',
        configResolved(config) { root = config.root; out = resolve(root, config.build.outDir); },
        configureServer(server) {
            const files = new Map(inventory().map(([source, target]) => [target, source]));
            server.middlewares.use((req, res, next) => {
                const path = files.get((req.url || '').split('?')[0]); if (!path) return next();
                const types = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.woff2': 'font/woff2' };
                res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); createReadStream(path).pipe(res);
            });
        },
        closeBundle() { for (const [source, target] of inventory()) { const destination = join(out, target.slice(1)); mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination); } }
    };
}
