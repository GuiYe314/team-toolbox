import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

// 仅支持本机/内网部署；与 ARCHITECTURE 第 7、8 节一致。
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devHost = env.VITE_DEV_HOST || '127.0.0.1';
    const devPort = Number(env.VITE_DEV_PORT) || 5173;
    const apiBase = env.VITE_API_BASE || '/api';

    return {
        plugins: [vue()],
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