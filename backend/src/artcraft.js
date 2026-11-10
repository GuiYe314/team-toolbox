import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fields, problem, executablePath } from './integration-common.js';

export function launchArtcraft(file) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, [], { cwd: dirname(file), shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
        child.once('error', () => reject(problem('launch_failed', 'ArtCraft 启动请求失败，请检查安装及运行权限', 500)));
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}

export function createArtcraftService({ config, launcher = launchArtcraft, validator = executablePath, now = Date.now } = {}) {
    let launching = false, lastLaunch = null;
    async function getConfig() {
        const value = await config.read();
        let available = false;
        if (value.artcraftPath) { try { await validator(value.artcraftPath, 'artcraft'); available = true; } catch { /* 保存后文件可能被移动，明确返回不可用 */ } }
        return { path: value.artcraftPath, available, lastLaunch };
    }
    async function configure(body) {
        fields(body, ['path']);
        if (launching) throw problem('busy', 'ArtCraft 正在启动，请稍后修改设置', 409);
        if (typeof body.path !== 'string') throw problem('invalid_path', '请选择 ArtCraft.exe 完整路径');
        const path = body.path ? await validator(body.path, 'artcraft') : '';
        await config.update({ artcraftPath: path });
        return getConfig();
    }
    async function launch(body) {
        fields(body, ['confirm']);
        if (body.confirm !== true) throw problem('confirmation_required', '请先确认在这台电脑打开 ArtCraft');
        if (launching || lastLaunch !== null && now() - lastLaunch < 5000) throw problem('busy', '已发送启动请求，请等待 ArtCraft 窗口出现后再试', 409);
        launching = true;
        try {
            const value = await config.read();
            if (!value.artcraftPath) throw problem('missing_dependency', '尚未配置 ArtCraft，请先安装并选择 ArtCraft.exe');
            const path = await validator(value.artcraftPath, 'artcraft');
            await launcher(path); lastLaunch = now();
            return { requested: true, message: '已发送 ArtCraft 启动请求，请查看它的窗口；编辑器就绪状态尚未检测', lastLaunch };
        } finally { launching = false; }
    }
    return { getConfig, configure, launch };
}
