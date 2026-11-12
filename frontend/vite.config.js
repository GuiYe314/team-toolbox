import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { toolAccessPlugin } from './tool-access-plugin.js';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('../backend/package.json',import.meta.url),'utf8')).version;
export default defineConfig(({mode})=>{
    const env=loadEnv(mode,process.cwd(),''), allowLan=env.TOOLBOX_ALLOW_LAN==='1';
    const host=env.VITE_DEV_HOST||(allowLan?'0.0.0.0':'127.0.0.1');
    return {define:{__APP_VERSION__:JSON.stringify(version)},plugins:[toolAccessPlugin({allowLan}),vue()],server:{host,port:Number(env.VITE_DEV_PORT)||5174,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:'+(Number(env.PORT)||3100),changeOrigin:false}}},preview:{host},build:{outDir:'dist',assetsDir:'static',target:'es2022',sourcemap:false}};
});
