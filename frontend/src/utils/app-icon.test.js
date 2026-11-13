import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ICONS, APP_ICON_STORAGE_KEY, DEFAULT_APP_ICON_ID, getAppIcon, readAppIcon, saveAppIcon } from './app-icon.js';

test('内置图标允许往返保存，目录 ID 唯一且所有资源保持同源', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    assert.equal(new Set(APP_ICONS.map(icon => icon.id)).size, 5);
    assert.equal(readAppIcon(storage), DEFAULT_APP_ICON_ID);
    for (const icon of APP_ICONS) {
        assert.ok(Object.isFrozen(icon));
        assert.ok([icon.image, icon.favicon, icon.touch, icon.ico].every(url => url.startsWith('/icons/') && !url.includes('..')));
        assert.equal(saveAppIcon(icon.id, storage), true);
        assert.equal(readAppIcon(storage), icon.id);
        assert.equal(values.get(APP_ICON_STORAGE_KEY), icon.id);
    }
});

test('非法、旧格式或任意地址的偏好只回退默认，不覆盖旧存储', () => {
    for (const value of [null, '', 'missing', '{bad', '{"id":"cat-window"}', 'https://example.com/evil.svg', '//example.com/icon.png', '../../file']) {
        let writes = 0;
        const storage = { getItem: () => value, setItem: () => writes++ };
        assert.equal(readAppIcon(storage), DEFAULT_APP_ICON_ID);
        assert.equal(getAppIcon(value).id, DEFAULT_APP_ICON_ID);
        assert.equal(writes, 0);
        assert.equal(saveAppIcon(value, storage), false);
        assert.equal(writes, 0);
    }
});

test('存储被禁用或写满时可以降级，权限恢复后可重试', () => {
    let blocked = true;
    const values = new Map();
    const storage = {
        getItem(key) { if (blocked) throw new Error('SecurityError'); return values.get(key); },
        setItem(key, value) { if (blocked) throw new Error('QuotaExceededError'); values.set(key, value); }
    };
    assert.equal(readAppIcon(storage), DEFAULT_APP_ICON_ID);
    assert.equal(saveAppIcon('cat-window', storage), false);
    assert.equal(readAppIcon(null), DEFAULT_APP_ICON_ID);
    assert.equal(saveAppIcon('cat-window', null), false);
    blocked = false;
    assert.equal(saveAppIcon('cat-window', storage), true);
    assert.equal(readAppIcon(storage), 'cat-window');
});
