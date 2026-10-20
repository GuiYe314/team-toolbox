import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';
import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, readdirSync, unlinkSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * 自托管 Vditor 静态资源。
 *
 * 背景：Vditor 默认从 unpkg CDN 拉取 3.7MB 的 lute 渲染内核
 * （e.CDN = "https://unpkg.com/vditor@4.0.1"），断网或内网环境会直接初始化失败。
 * 本工具只在本机/内网运行，因此把这些资源复制到本地托管。
 *
 * 路径约定（踩过坑）：Vditor 内部**固定**在 cdn 值后面拼 "/dist/js/..."、"/dist/css/..."，
 * 例如 `${cdn}/dist/js/lute/lute.min.js`。
 * 所以对外 URL 必须是 /vendor/vditor/dist/js/lute/lute.min.js 这样的形状：
 *   - cdn 配置值填 '/vendor/vditor'（Vditor 自己补 /dist）
 *   - 落盘目录也保留 dist 一层，dev 中间件与构建产物才和它的拼接规则对上
 * 早期把文件直接铺在 /vendor/vditor/ 下（少了 dist 一层），
 * 结果它请求 /vendor/vditor/dist/js/i18n/zh_CN.js → 404 → 编辑器静默不初始化。
 *
 * 为什么不把文件提交进仓库：lute.min.js 有 3.7MB，提交后每次 clone 都要拉一份，
 * 且升级 vditor 时容易与仓库里的副本不同步。从 node_modules 复制可保证
 * 版本永远与 package.json 一致。
 *
 * 复制的文件刻意最小化：主 js/css + lute 内核 + ant 图标 + 中文语言包。
 * 其余按需插件（mermaid/katex/echarts 等）本项目用不到，不复制。
 */
/**
 * 递归清空目录：先删文件、再从深到浅删空目录。
 * 逐项操作比 rmSync(recursive) 更稳：某些环境会把 rmSync 改走回收站，
 * 递归删目录会因「部分操作被中止」失败。
 * @param {string} dir
 */
function clearDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            clearDir(full);
            try { rmdirSync(full); } catch { /* 非空则跳过 */ }
        } else {
            try { unlinkSync(full); } catch { /* 被占用则跳过 */ }
        }
    }
}

function vditorAssets() {
    const SRC = dirname(require.resolve('vditor/package.json'));
    // 源路径（相对包根） → 目标路径（相对 public/vendor/vditor）
    const FILES = [
        ['dist/index.min.js', 'dist/index.min.js'],
        ['dist/index.css', 'dist/index.css'],
        ['dist/js/lute/lute.min.js', 'dist/js/lute/lute.min.js'],
        ['dist/js/icons/ant.js', 'dist/js/icons/ant.js'],
        ['dist/js/i18n/zh_CN.js', 'dist/js/i18n/zh_CN.js']
    ];
    // 存在闭包里：Vite 调用插件钩子时 this 不是插件实例，不能挂自定义属性
    let outDir = null;
    let warn = () => {};
    return {
        name: 'vditor-assets',
        configResolved(config) {
            outDir = join(config.publicDir, 'vendor', 'vditor');
        },
        configureServer(server) {
            // 开发期直接映射到 node_modules，避免每次重启都复制 3.7MB
            server.middlewares.use((req, res, next) => {
                const url = (req.url || '').split('?')[0];
                if (!url.startsWith('/vendor/vditor/')) return next();
                // 与 Vditor 的拼接规则对齐：去掉前缀后应正好命中 dist/...
                const rel = url.slice('/vendor/vditor/'.length);
                // 防目录穿越：只允许 FILES 里列出的相对路径（严格全等匹配）
                const hit = FILES.find(([, to]) => to === rel);
                if (!hit) return next();
                const file = join(SRC, hit[0]);
                if (!existsSync(file)) {
                    res.statusCode = 404;
                    res.end('vditor asset not found');
                    return;
                }
                res.setHeader('Content-Type', rel.endsWith('.css')
                    ? 'text/css' : 'application/javascript; charset=utf-8');
                createReadStream(file).pipe(res);
            });
        },
        closeBundle() {
            // 先清空目标目录：调整过路径布局后，旧布局的残留文件不会被
            // Vite 清掉（它只管 dist/assets），会留下两份同名资源。
            //
            // 逐项删除而不是 rmSync(recursive)：部分环境（如 WorkBuddy 的
            // 删除保护）会把 rmSync 改走回收站，递归删目录会因「部分操作被中止」
            // 而失败。逐文件删完再删空目录，在两种环境都能稳定通过。
            if (outDir && existsSync(outDir)) {
                try {
                    rmSync(outDir, { recursive: true, force: true });
                } catch {
                    // 回退：逐层清理
                    try { clearDir(outDir); } catch { warn('vditor 旧资源清理失败，将直接覆盖'); }
                }
            }
            for (const [from, to] of FILES) {
                const src = join(SRC, from);
                const dst = join(outDir, to);
                if (!existsSync(src)) {
                    warn(`vditor 资源缺失，已跳过：${from}`);
                    continue;
                }
                mkdirSync(dirname(dst), { recursive: true });
                cpSync(src, dst);
            }
        }
    };
}

// 仅支持本机/内网部署；与 ARCHITECTURE 第 7、8 节一致。
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devHost = env.VITE_DEV_HOST || '127.0.0.1';
    const devPort = Number(env.VITE_DEV_PORT) || 5173;
    const apiBase = env.VITE_API_BASE || '/api';

    return {
        plugins: [vue(), vditorAssets()],
        server: {
            host: devHost,
            port: devPort,
            strictPort: false,
            // 开发期把 /api 前缀代理到 backend，避免跨域；生产构建由 Nginx/Node 静态托管时另行配置。
            proxy: {
                [apiBase]: {
                    target: 'http://127.0.0.1:3000',
                    changeOrigin: false,
                    rewrite: (path) => path.replace(new RegExp(`^${apiBase}`), '/api')
                }
            }
        },
        build: {
            outDir: 'dist',
            sourcemap: false,
            target: 'es2020'
        }
    };
});