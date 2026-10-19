import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { initTheme } from './styles/theme.js';

/* 样式分层：tokens（不变量的尺度）→ theme（Light/Dark 变量）→ glass（玻璃材质）
   → layout（四栏网格）→ components（跨视图原子样式）。
   顺序不可颠倒：后一层只允许依赖前一层定义的变量。*/
import './styles/tokens.css';
import './styles/theme.css';
import './styles/glass.css';
import './styles/layout.css';
import './styles/components.css';

// 在挂载前应用主题，避免首屏 Light → Dark 闪烁
initTheme();

createApp(App).use(router).mount('#app');