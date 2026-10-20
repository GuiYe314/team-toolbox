import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { initTheme } from './styles/theme.js';

/* 样式分层：tokens（不变量的尺度）→ theme（Light/Dark 变量）→ glass（玻璃材质）
   → layout（四栏网格）→ components（跨视图原子样式）→ vditor（编辑器 token 适配）。
   顺序不可颠倒：后一层只允许依赖前一层定义的变量。

   vditor.css 必须排在 components.css 之后：它是对第三方库样式的覆盖，
   靠层叠顺序取胜，若提前引入会被 components.css 的同优先级规则盖回去。*/
import './styles/tokens.css';
import './styles/theme.css';
import './styles/glass.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/vditor.css';
import './styles/hint.css';

// 全局指令：v-hint（延迟 1 秒的悬停提示）
import hintDirective from './directives/hint.js';

// 在挂载前应用主题，避免首屏 Light → Dark 闪烁
initTheme();

const app = createApp(App);
app.use(router);
app.use(hintDirective);
app.mount('#app');