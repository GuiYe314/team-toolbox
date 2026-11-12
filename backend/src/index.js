import { createDeviceDebuggerApp, readListenOptions } from './server.js';
import { getAppVersion } from './version.js';
const runtime = createDeviceDebuggerApp();
let address;
try { address = readListenOptions(process.env, runtime.access.allowLan); }
catch(error) { console.error('[device-debugger]',error.message); runtime.dispose(); process.exit(1); }
const server = runtime.app.listen(address.port,address.host,()=>console.log('[device-debugger] v'+getAppVersion()+' listening on http://'+address.host+':'+address.port));
server.on('error', error => { console.error('[device-debugger] 启动失败：'+error.code); runtime.dispose(); process.exitCode=1; });
let closing = false;
function shutdown() { if(closing)return; closing=true; runtime.dispose(); server.close(()=>process.exit(0)); server.closeAllConnections(); const timer=setTimeout(()=>process.exit(1),5000);timer.unref(); }
process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown); process.once('exit',runtime.dispose);
