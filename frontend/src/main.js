import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import { primeVueOptions } from './ui/primevue.js';
import { uiMotionPlugin } from './ui/motion.js';
import App from './App.vue';
import router from './router/index.js';
import { initTheme } from './styles/theme.js';
import { initAppIcon } from './stores/app-icon.js';
import { initToolWorkspace } from './stores/tool-workspace.js';

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
import './styles/click-feedback.css';
import './styles/vditor.css';
import './styles/hint.css';
import './styles/assets.css';
import './styles/android.css';
import './styles/unity-logs.css';
import './styles/integrations.css';
import './styles/phone-album.css';
import './styles/tool-workspace.css';
import './styles/workshops.css';
import './styles/quick-calculation.css';
import './styles/knowledge-sops.css';
import './styles/knowledge-workbench.css';
import './styles/primevue.css';

// 全局指令：v-hint（延迟 1 秒的悬停提示）
import hintDirective from './directives/hint.js';

// 在挂载前应用主题，避免首屏 Light → Dark 闪烁
initTheme();
initAppIcon();
initToolWorkspace();

const app = createApp(App);
app.use(PrimeVue, primeVueOptions());
app.use(uiMotionPlugin);
app.use(router);
app.use(hintDirective);
// 等首个路由确定后挂载，手机上传页不会短暂挂载桌面侧栏或请求知识库。
router.isReady().then(() => app.mount('#app'));
