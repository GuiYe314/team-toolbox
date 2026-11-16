export const LivePhotoPreviewProvider = {
    id: 'live-photo',
    canHandle: (asset, version) => asset?.type === 'image' && version?.metadata?.livePhoto?.detected === true,
    async mount(container, { asset, version, fileUrl, previewUrl }) {
        const live = version.metadata.livePhoto, pointer = version.versionNumber || 'latest';
        const root = document.createElement('div'); root.className = 'pv-live'; root.dataset.livePhoto = live.status;
        const stage = document.createElement('div'); stage.className = 'pv-live-stage';
        const image = document.createElement('img'); image.className = 'pv-image'; image.alt = asset.name;
        image.src = previewUrl || fileUrl(asset.id, 'original', pointer);
        const video = document.createElement('video'); video.className = 'pv-video'; video.hidden = true; video.muted = true; video.playsInline = true; video.controls = true; video.preload = 'none';
        const controls = document.createElement('div'); controls.className = 'pv-live-controls';
        const badge = document.createElement('span'); badge.className = 'pv-live-badge'; badge.textContent = '实况';
        const button = document.createElement('button'); button.className = 'btn btn-primary'; button.type = 'button'; button.dataset.test = 'live-play'; button.textContent = '播放实况'; button.disabled = live.status !== 'ready'; button.setAttribute('aria-pressed', 'false');
        const message = document.createElement('p'); message.className = 'am-hint'; message.setAttribute('role', 'status');
        message.textContent = live.status === 'ready' ? `默认静音 · 动态预览最长${live.maxPreviewSeconds || 30}秒${live.posterFromVideo ? ' · 封面取自动态首帧，原照片保留在原件中' : ''}` : (live.error || '实况播放预览尚未生成，可下载原件');
        controls.append(badge, button);
        if (live.status === 'ready') { const download = document.createElement('a'); download.className = 'btn'; download.textContent = '下载动态视频'; download.href = fileUrl(asset.id, 'motion', pointer, true); controls.appendChild(download); }
        stage.append(image, video); root.append(stage, controls, message); container.appendChild(root);
        let disposed = false, starting = false;
        const reset = () => { if (disposed) return; starting = false; video.hidden = true; image.hidden = false; button.textContent = '播放实况'; button.setAttribute('aria-pressed', 'false'); };
        const stop = () => { starting = false; video.pause(); if (Number.isFinite(video.duration)) video.currentTime = 0; reset(); };
        const play = async () => {
            if (disposed || document.hidden) return;
            if (!video.paused || starting) { stop(); return; }
            starting = true; button.textContent = '停止实况'; button.setAttribute('aria-pressed', 'true');
            if (!video.getAttribute('src')) video.src = fileUrl(asset.id, 'motion', pointer);
            try { await video.play(); if (disposed || document.hidden || !starting) { video.pause(); return; } image.hidden = true; video.hidden = false; }
            catch { if (!disposed) { reset(); message.textContent = '动态播放失败，可重试或下载原件/动态视频；照片仍保留'; } }
        };
        const error = () => { if (!disposed) { reset(); message.textContent = '浏览器无法解码或动态文件不可用，可重试或下载原件'; video.removeAttribute('src'); } };
        const visibility = () => { if (document.hidden) stop(); };
        button.addEventListener('click', play); video.addEventListener('ended', reset); video.addEventListener('error', error); document.addEventListener('visibilitychange', visibility);
        return () => { disposed = true; starting = false; document.removeEventListener('visibilitychange', visibility); button.removeEventListener('click', play); video.removeEventListener('ended', reset); video.removeEventListener('error', error); video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); root.remove(); };
    },
    destroy() {}
};
