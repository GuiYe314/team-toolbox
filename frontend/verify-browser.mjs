// 隔离构建产物验收共用的临时无头浏览器；不连接用户浏览器或读取其资料。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function testBrowser(temporary) {
    const profile = join(temporary, 'browser'); await mkdir(profile);
    const exe = process.env.BROWSER_EXE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    assert.ok(exe, '未找到测试浏览器');
    const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1700,1100', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => browser.once('exit', resolve));
    let ws; const pending = new Map(), errors = [], requests = []; let next = 0;
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
            pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }
    const close = async () => {
        if (ws?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); ws.close(); }
        await Promise.race([exited, delay(2000)]); if (browser.exitCode === null) browser.kill(); await Promise.race([exited, delay(2000)]);
    };
    try {
        const portFile = join(profile, 'DevToolsActivePort');
        for (let i = 0; i < 100 && !existsSync(portFile); i++) await delay(100);
        assert.ok(existsSync(portFile), '浏览器未就绪');
        const port = Number((await readFile(portFile, 'utf8')).split(/\r?\n/)[0]);
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
        ws.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
            if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
        });
        await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
        await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
        const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; };
        const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(70); } throw new Error('界面等待超时：' + expression); };
        const click = async selector => { await wait(`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`); return evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
        const fill = (selector, value, event = 'input') => evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));}`);
        const select = (selector, value) => fill(selector, value, 'change');
        const choose = async (selector, file) => { const doc = await send('DOM.getDocument'); const element = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector }); await send('DOM.setFileInputFiles', { nodeId: element.nodeId, files: [file] }); };
        return { send, evaluate, wait, click, fill, select, choose, close, errors, requests };
    } catch (error) { await close(); throw error; }
}
export async function removeBrowserFixture(directory) {
    for (let i = 0; i < 20; i++) { try { await rm(directory, { recursive: true, force: true }); return; } catch (error) { if (i === 19) throw error; await delay(150); } }
}
