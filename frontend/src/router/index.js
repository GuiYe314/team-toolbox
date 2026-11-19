import { createRouter, createWebHistory } from 'vue-router';

const routes = [
    { path: '/tools/remote-files', name: 'tool-remote-files', component: () => import('../views/RemoteFiles.vue') },
    { path: '/tools/file-share', name: 'tool-file-share', component: () => import('../views/FileShare.vue') },
    { path: '/file-share', name: 'shared-files', component: () => import('../views/SharedFiles.vue'), meta: { mobileUpload: true } },
    { path: '/tools/quick-calculation', name: 'tool-quick-calculation', component: () => import('../views/QuickCalculation.vue') },
    { path: '/transfer', name: 'peer-transfer-mobile', component: () => import('../views/PeerTransfer.vue'), meta: { mobileUpload: true } },
    { path: '/tools/image-batch', name: 'tool-image-batch', component: () => import('../views/MediaWorkshop.vue'), props: { kind: 'image' } },
    { path: '/tools/image-ocr', name: 'tool-image-ocr', component: () => import('../views/ImageOcr.vue') },
    { path: '/tools/pdf', name: 'tool-pdf', component: () => import('../views/PdfWorkshop.vue') },
    { path: '/tools/video-process', name: 'tool-video-process', component: () => import('../views/VideoWorkshop.vue') },
    { path: '/tools/whiteboard', name: 'tool-whiteboard', component: () => import('../views/Whiteboard.vue') },
    { path: '/tools/peer-transfer', name: 'tool-peer-transfer', component: () => import('../views/PeerTransfer.vue') },
    { path: '/tools/android-mirror', name: 'tool-android-mirror', component: () => import('../views/AndroidMirror.vue') },
    { path: '/tools/developer-tools', name: 'tool-developer-tools', component: () => import('../views/DeveloperTools.vue') },
    { path: '/phone-album', name: 'phone-album-upload', component: () => import('../views/PhoneAlbumUpload.vue'), meta: { mobileUpload: true } },
    { path: '/tools/phone-album', name: 'tool-phone-album', component: () => import('../views/PhoneAlbum.vue') },
    {
        path: '/',
        name: 'home',
        component: () => import('../views/Home.vue')
    },
    {
        path: '/kb',
        name: 'kb-list',
        component: () => import('../views/KnowledgeBase.vue')
    },
    {
        path: '/kb/new',
        name: 'kb-new',
        component: () => import('../views/DocumentEdit.vue')
    },
    { path: '/kb/sops', name: 'kb-sops', component: () => import('../views/KnowledgeSops.vue') },
    { path: '/kb/workbench', name: 'kb-workbench', component: () => import('../views/KnowledgeWorkbench.vue') },
    {
        // 必须注册在 /kb/:id 之前，否则 "trash" 会被当成文档 id。
        path: '/kb/trash',
        name: 'kb-trash',
        component: () => import('../views/KnowledgeTrash.vue')
    },
    {
        path: '/kb/:id',
        name: 'kb-detail',
        component: () => import('../views/DocumentDetail.vue')
    },
    {
        path: '/kb/:id/edit',
        name: 'kb-edit',
        component: () => import('../views/DocumentEdit.vue')
    },
    {
        path: '/assets',
        name: 'assets',
        component: () => import('../views/Assets.vue')
    },
    {
        // 集合列表与详情。注册在 /assets 之后即可 —— 资源详情是弹窗不是路由，
        // 不存在 /assets/:id 抢匹配的问题。
        path: '/assets/collections',
        name: 'asset-collections',
        component: () => import('../views/AssetCollections.vue')
    },
    {
        path: '/assets/collections/:id',
        name: 'asset-collection-detail',
        component: () => import('../views/AssetCollectionDetail.vue')
    },
    {
        path: '/tools',
        name: 'tools',
        component: () => import('../views/Tools.vue')
    },
    {
        path: '/tools/ratio-lock',
        name: 'tool-ratio-lock',
        component: () => import('../views/RatioLock.vue')
    },
    {
        path: '/tools/yoinks',
        name: 'tool-yoinks',
        component: () => import('../views/YoinksDownload.vue')
    },
    { path: '/tools/freellmapi', redirect: { name: 'tools' } },
    { path: '/tools/artcraft', redirect: { name: 'tools' } },
    {
        path: '/tools/ports',
        name: 'tool-ports',
        component: () => import('../views/PortViewer.vue')
    },
    {
        path: '/tools/network-speed',
        name: 'tool-network-speed',
        component: () => import('../views/NetworkSpeed.vue')
    },
    {
        path: '/tools/earth-sunlight',
        name: 'tool-earth-sunlight',
        component: () => import('../views/EarthSunlight.vue')
    },
    {
        path: '/tools/json-fmt',
        name: 'tool-json-fmt',
        component: () => import('../views/DeveloperTools.vue')
    },
    {
        path: '/tools/android-wireless',
        name: 'tool-android-wireless',
        component: () => import('../views/AndroidWireless.vue')
    },
    {
        path: '/tools/unity-logs',
        name: 'tool-unity-logs',
        component: () => import('../views/UnityLogs.vue')
    },
    {
        path: '/tools/qrcode',
        name: 'tool-qrcode',
        component: () => import('../views/DeveloperTools.vue')
    },
    {
        path: '/settings',
        name: 'settings',
        component: () => import('../views/Settings.vue')
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../views/NotFound.vue')
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;
