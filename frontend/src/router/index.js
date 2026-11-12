import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({history:createWebHistory(),routes:[
    {path:'/',redirect:'/tools'},
    {path:'/tools',name:'tools',component:()=>import('../views/Tools.vue')},
    {path:'/tools/android-wireless',name:'tool-android-wireless',component:()=>import('../views/AndroidWireless.vue')},
    {path:'/tools/unity-logs',name:'tool-unity-logs',component:()=>import('../views/UnityLogs.vue')},
    {path:'/settings',name:'settings',component:()=>import('../views/Settings.vue')},
    {path:'/:pathMatch(.*)*',redirect:'/tools'}
]});
