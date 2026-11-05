import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdbError } from './android-adb-protocol.js';

const allowedCommands = new Set(['shell', 'reboot', 'get-state', 'get-serialno', 'get-devpath', 'features', 'logcat']);
const customId = /^custom-[0-9a-f-]{36}$/;
const revisionId = /^[0-9a-f-]{36}$/;

/** 解析单条参数；反斜杠路径保持原样，仅处理引号和反斜杠转义。 */
export function parseAndroidArguments(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048 || /[\x00-\x1f\x7f|&;<>`$]/.test(raw)) {
        throw new AdbError('invalid_input', '请填写一条 ADB 参数（最多 2048 字），不支持换行、管道、重定向或命令拼接');
    }
    const args = []; let quote = '', token = '', started = false;
    for (let index = 0; index < raw.length; index++) {
        const character = raw[index];
        if (character === '\\' && quote !== "'" && ['\\', '"', "'"].includes(raw[index + 1])) { token += raw[++index]; started = true; }
        else if (quote) { if (character === quote) quote = ''; else token += character; }
        else if (character === '"' || character === "'") { quote = character; started = true; }
        else if (/\s/.test(character)) { if (started) { args.push(token); token = ''; started = false; } }
        else { token += character; started = true; }
    }
    if (quote) throw new AdbError('invalid_input', '命令中的引号未闭合，请检查后保存');
    if (started) args.push(token);
    if (args.length > 64 || !allowedCommands.has(args[0])) {
        throw new AdbError('invalid_input', '命令需以 shell、reboot、get-state、get-serialno、get-devpath、features 或 logcat 开头；不用填写 adb 或 -s 设备参数');
    }
    if (args[0] === 'shell' && (!args[1] || args[1].startsWith('-'))) throw new AdbError('invalid_input', '请在 shell 后填写设备命令，例如 shell dumpsys meminfo com.example.app');
    return args;
}

// adb shell 会把余下参数拼接给手机 Shell，带空格/引号的值必须再次引用。
function remoteLiteral(value) { return /^[A-Za-z0-9_.,:/@%+=-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"; }

function fields(input, editing = false) {
    const keys = ['title', 'category', 'description', 'arguments', ...(editing ? ['revision'] : [])];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new AdbError('invalid_input', '自定义命令字段无效');
    function text(key, limit, fallback = '') {
        const value = input[key] ?? fallback;
        if (typeof value !== 'string' || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw new AdbError('invalid_input', `命令${{ title: '名称', category: '分类', description: '说明', arguments: '参数' }[key]}无效或过长`);
        return value.trim();
    }
    const result = { title: text('title', 60), category: text('category', 30) || '自定义', description: text('description', 400), arguments: text('arguments', 2048) };
    if (!result.title) throw new AdbError('invalid_input', '请填写命令名称');
    parseAndroidArguments(result.arguments);
    return result;
}

function definition(record) {
    const parsed = parseAndroidArguments(record.arguments);
    return { ...record, custom: true, requiresConfirmation: true, preview: 'adb -s <设备> ' + record.arguments,
        args: parsed[0] === 'shell' ? ['shell', ...parsed.slice(1).map(remoteLiteral)] : parsed };
}

export function createAndroidCustomCommands({ file, log = () => {} }) {
    function read() {
        try {
            if (statSync(file).size > 1024 * 1024) throw new Error('too_large');
            const saved = JSON.parse(readFileSync(file, 'utf8'));
            if (saved.version !== 1 || !Array.isArray(saved.commands) || saved.commands.length > 100) throw new Error('bad_config');
            const ids = new Set(), titles = new Set();
            return saved.commands.map(record => {
                if (!record || !customId.test(record.id) || !revisionId.test(record.revision) || ids.has(record.id)) throw new Error('bad_record');
                const { id, revision, ...input } = record;
                const valid = fields(input), title = valid.title.toLowerCase();
                if (titles.has(title)) throw new Error('duplicate_title');
                ids.add(id); titles.add(title);
                return { id, revision, ...valid };
            });
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            log({ action: 'custom_commands_read', ok: false, code: 'config_error' });
            throw new AdbError('config_error', '自定义命令配置无法读取，请检查服务器上的 android-commands.json；未覆盖原文件', 500);
        }
    }
    function write(records) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(temporary, JSON.stringify({ version: 1, commands: records }), { encoding: 'utf8', mode: 0o600 });
            renameSync(temporary, file);
        } catch { throw new AdbError('config_error', '自定义命令保存失败，请检查服务器数据目录权限', 500); }
        finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') log({ action: 'custom_commands_cleanup', ok: false, code: error.code }); } }
    }
    function find(records, id, revision) {
        const record = records.find(item => item.id === id);
        if (!record) throw new AdbError('not_found', '自定义命令已删除，请重新读取命令列表', 404);
        if (record.revision !== revision) throw new AdbError('command_changed', '自定义命令已更新，请重新读取列表后核对命令', 409);
        return record;
    }
    return {
        list: () => read().map(record => { const { args, ...command } = definition(record); return command; }),
        resolve(request) {
            if (!customId.test(request.id)) return null;
            return definition(find(read(), request.id, request.revision));
        },
        save(input, id) {
            const value = fields(input, !!id), records = read();
            if (id) find(records, id, input.revision);
            else if (records.length >= 100) throw new AdbError('invalid_input', '最多保存 100 条自定义命令，请先删除不再使用的命令');
            if (records.some(item => item.id !== id && item.title.toLowerCase() === value.title.toLowerCase())) throw new AdbError('invalid_input', '已有同名自定义命令，请换一个名称');
            const record = { id: id || 'custom-' + randomUUID(), revision: randomUUID(), ...value };
            write(id ? records.map(item => item.id === id ? record : item) : [...records, record]);
            const { args, ...command } = definition(record); return { command };
        },
        remove(id, { confirm, revision } = {}) {
            if (confirm !== true) throw new AdbError('confirmation_required', '删除自定义命令需要再次确认');
            const records = read(); find(records, id, revision); write(records.filter(item => item.id !== id));
            return { message: '自定义命令已删除' };
        }
    };
}
