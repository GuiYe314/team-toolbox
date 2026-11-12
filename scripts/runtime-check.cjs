const { createRequire } = require('node:module');
const path = require('node:path');
try {
    const [major,minor]=process.versions.node.split('.').map(Number);
    if(major<22||(major===22&&minor<15))throw new Error('Node 22.15 or newer is required; use the bundled runtime.');
    const requireApp=createRequire(path.join(__dirname,'..','backend','package.json'));
    if(typeof requireApp('express')!=='function'||typeof requireApp('yauzl').open!=='function')throw new Error('Application dependencies are incomplete.');
    console.log('[check] Device Debugger runtime ready ('+process.version+').');
} catch(error){console.error('[ERROR] '+error.message+' Download the complete Device Debugger package.');process.exit(1);}
