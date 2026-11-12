import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRODUCT = 'device-debugger';
export function getAppVersion() {
    return JSON.parse(readFileSync(join(APP_ROOT, 'backend', 'package.json'), 'utf8')).version;
}
