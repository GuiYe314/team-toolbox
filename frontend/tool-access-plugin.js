import { createToolAccess } from '../backend/src/tool-access.js';

/** 必须先检查真实 TCP 来源，再交给回环代理；不能让代理掩盖外部来源。 */
export function toolAccessPlugin(options) {
    const access = createToolAccess(options);
    const configure = server => {
        server.middlewares.use(access.middleware);
        const checkUpgrade = (req, socket) => {
            if (!access.allows(req, { browser: true })) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
            }
        };
        server.httpServer?.prependListener('upgrade', checkUpgrade);
        server.httpServer?.once('close', () => server.httpServer.removeListener('upgrade', checkUpgrade));
    };
    return { name: 'toolbox-network-access', configureServer: configure, configurePreviewServer: configure };
}
