import express from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerAndroidApi } from './android-api.js';
import { registerUnityLogApi } from './unity-log-api.js';
import { createToolAccess } from './tool-access.js';
import { APP_ROOT, getAppVersion, PRODUCT } from './version.js';

export function readListenOptions(env = process.env, allowLan = false) {
    const raw = env.PORT || '3100';
    if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error('PORT 必须为 1～65535 的整数');
    const host = env.HOST || (allowLan ? '0.0.0.0' : '127.0.0.1');
    if (!['127.0.0.1', '::1', ...(allowLan ? ['0.0.0.0'] : [])].includes(host)) throw new Error('HOST 与 Local/Lan 访问模式不匹配');
    return { host, port: Number(raw) };
}

export function createDeviceDebuggerApp({ access = createToolAccess(), androidService, unityService, frontendDist = join(APP_ROOT, 'frontend', 'dist'), log = message => console.error('[device-debugger]', message) } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use(access.middleware);
    app.use('/api', (_req,res,next) => { res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); next(); });
    app.use(express.json({limit:'64kb'}));
    const android = registerAndroidApi(app, { access, ...(androidService ? { service: androidService } : {}) });
    const unity = registerUnityLogApi(app, { access, ...(unityService ? { service: unityService } : {}) });
    app.get('/api/health', (_req,res) => res.json({status:'ok',service:'device-debugger-backend',product:PRODUCT,version:getAppVersion(),features:['android','unity-logs'],accessMode:access.allowLan?'Lan':'Local'}));
    app.use('/api', (_req,res) => res.status(404).json({error:'not_found',message:'独立版仅提供安卓调试与 Unity 日志接口'}));
    if (frontendDist && existsSync(join(frontendDist,'index.html'))) {
        app.use(express.static(resolve(frontendDist), {index:false,dotfiles:'deny',setHeaders(res,path) { res.setHeader('Cache-Control', /-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'); }}));
        app.get(['/', '/tools', '/tools/android-wireless', '/tools/unity-logs', '/settings'], (_req,res) => { res.setHeader('Cache-Control','no-cache'); res.sendFile(resolve(frontendDist,'index.html')); });
    }
    app.use((_req,res) => res.status(404).type('text').send('页面不存在'));
    app.use((error,_req,res,_next) => {
        if (res.headersSent) return res.destroy();
        const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
        if (status === 500) log('request_failed');
        res.status(status).json({error:status===500?'internal_error':'invalid_input',message:status===500?'服务暂时无法处理请求':'请求格式或大小无效'});
    });
    let disposed = false;
    const dispose = () => { if(disposed) return; disposed=true; android.dispose(); unity.dispose(); };
    return {app,dispose,access};
}
