import { createRouter, createWebHistory } from 'vue-router';

const routes = [
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
        path: '/tools/json-fmt',
        name: 'tool-json-fmt',
        component: () => import('../views/ToolEmptyState.vue')
    },
    {
        path: '/tools/qrcode',
        name: 'tool-qrcode',
        component: () => import('../views/ToolEmptyState.vue')
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
