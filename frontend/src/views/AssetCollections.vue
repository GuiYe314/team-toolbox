<template>
    <div class="col-page">
        <header class="col-head">
            <div class="col-head-text">
                <h1 class="col-title">资源集合</h1>
                <p class="col-desc">
                    集合把分散在不同文件夹里的资源编成一组，比如「这次展会要用的模型」。
                    同一个资源可以同时属于多个集合。<br />
                    <strong>把资源从集合里移除，不会删除文件本身</strong>，也不会影响它在文件夹里的位置。
                </p>
            </div>
            <div class="col-head-actions">
                <router-link class="btn" to="/assets">返回资源管理</router-link>
                <button class="btn btn-primary" type="button" @click="openCreate">新建集合</button>
            </div>
        </header>

        <p v-if="loading && items.length === 0" class="state-loading">加载中…</p>

        <div v-else-if="errorText && items.length === 0" class="state-error">
            <p>{{ errorText }}</p>
            <button class="btn btn-sm" type="button" @click="load">重试</button>
        </div>

        <div v-else-if="items.length === 0" class="empty-state">
            <p class="empty-title">还没有集合</p>
            <p class="empty-desc">集合适合「临时把几个资源凑一起交付」，比文件夹灵活。</p>
            <button class="btn btn-sm" type="button" @click="openCreate">新建第一个集合</button>
        </div>

        <ul v-else class="col-grid">
            <li v-for="c in items" :key="c.id" class="col-card">
                <router-link class="col-card-main" :to="`/assets/collections/${c.id}`">
                    <div class="col-card-top">
                        <span class="col-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
                                <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
                            </svg>
                        </span>
                        <span class="col-name">{{ c.name }}</span>
                    </div>
                    <p v-if="c.description" class="col-card-desc">{{ c.description }}</p>
                    <p class="col-card-meta">
                        <strong>{{ c.assetCount }}</strong> 个资源 · 更新于 {{ formatTime(c.updatedAt) }}
                    </p>
                </router-link>
                <div class="col-card-actions">
                    <button class="btn btn-sm" type="button" @click="openRename(c)">重命名</button>
                    <button class="btn btn-sm btn-danger" type="button" @click="askDelete(c)">删除</button>
                </div>
            </li>
        </ul>

        <p v-if="message" class="col-message" :class="{ 'is-error': messageIsError }">{{ message }}</p>

        <!-- 新建 / 重命名弹窗（Teleport：glass 容器的 backdrop-filter 会创建包含块） -->
        <Teleport to="body">
            <div v-if="form" class="overlay" @click.self="form = null">
                <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="col-form-title">
                    <h2 class="dialog-title" id="col-form-title">{{ form.id ? '重命名集合' : '新建集合' }}</h2>
                    <label class="col-field">
                        <span class="col-label">名称</span>
                        <input
                            ref="nameInput"
                            v-model="form.name"
                            class="input"
                            type="text"
                            maxlength="40"
                            placeholder="例如：展会交付包"
                            @keyup.enter="submitForm"
                        />
                    </label>
                    <label class="col-field">
                        <span class="col-label">描述（可选）</span>
                        <textarea
                            v-model="form.description"
                            class="input col-textarea"
                            maxlength="500"
                            rows="3"
                            placeholder="这批资源是做什么用的"
                        ></textarea>
                    </label>
                    <p v-if="form.error" class="notice notice-error">{{ form.error }}</p>
                    <div class="dialog-actions">
                        <button class="btn" type="button" :disabled="busy" @click="form = null">取消</button>
                        <button class="btn btn-primary" type="button" :disabled="busy" @click="submitForm">
                            {{ busy ? '保存中…' : '保存' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- 删除确认 -->
        <Teleport to="body">
            <div v-if="deleting" class="overlay" @click.self="deleting = null">
                <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="col-del-title">
                    <h2 class="dialog-title" id="col-del-title">删除集合</h2>
                    <p class="dialog-text">
                        确定删除集合「<strong>{{ deleting.name }}</strong>」吗？
                    </p>
                    <p class="dialog-warn">
                        只会删除这个编组，<strong>集合里的 {{ deleting.assetCount }} 个资源不会被删除</strong>。
                    </p>
                    <div class="dialog-actions">
                        <button class="btn" type="button" :disabled="busy" @click="deleting = null">取消</button>
                        <button class="btn btn-danger-solid" type="button" :disabled="busy" @click="doDelete">
                            {{ busy ? '删除中…' : '删除集合' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script>
import { assetApi } from '../api/asset-client.js';

/**
 * 资源集合列表。
 *
 * 与文件夹的区分是这个页面存在的理由，所以说明文字里必须讲清楚：
 * 集合是跨文件夹的临时编组，一个资源可属多个集合，删集合不删资源。
 * 否则用户会以为它是「另一个文件夹」而不敢用。
 */
export default {
    name: 'AssetCollections',
    data() {
        return {
            items: [],
            loading: false,
            busy: false,
            errorText: '',
            message: '',
            messageIsError: false,
            form: null,
            deleting: null
        };
    },
    mounted() {
        this.load();
    },
    methods: {
        async load() {
            this.loading = true;
            this.errorText = '';
            try {
                const { res, body } = await assetApi.listCollections();
                if (!res.ok) throw new Error((body && body.message) || '加载集合失败');
                this.items = (body && body.items) || [];
            } catch (e) {
                this.errorText = e.network ? e.message : (e.message || '加载集合失败');
            } finally {
                this.loading = false;
            }
        },
        formatTime(v) {
            if (!v) return '未知';
            const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return v;
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        },
        notify(text, isError = false) {
            this.message = text;
            this.messageIsError = isError;
        },
        openCreate() {
            this.form = { id: null, name: '', description: '', error: '' };
            this.$nextTick(() => this.$refs.nameInput && this.$refs.nameInput.focus());
        },
        openRename(c) {
            this.form = { id: c.id, name: c.name, description: c.description || '', error: '' };
            this.$nextTick(() => this.$refs.nameInput && this.$refs.nameInput.focus());
        },
        async submitForm() {
            if (this.busy || !this.form) return;
            const name = (this.form.name || '').trim();
            if (!name) { this.form.error = '名称不能为空'; return; }

            this.busy = true;
            this.form.error = '';
            try {
                const isEdit = !!this.form.id;
                const { res, body } = isEdit
                    ? await assetApi.updateCollection(this.form.id, {
                        name, description: this.form.description || ''
                    })
                    : await assetApi.createCollection(name, this.form.description || '');
                if (!res.ok) throw new Error((body && body.message) || '保存失败');
                this.notify(isEdit ? '已重命名' : `已创建集合「${name}」`);
                this.form = null;
                await this.load();
            } catch (e) {
                this.form.error = e.network ? e.message : (e.message || '保存失败');
            } finally {
                this.busy = false;
            }
        },
        askDelete(c) {
            this.deleting = c;
        },
        async doDelete() {
            if (this.busy || !this.deleting) return;
            this.busy = true;
            try {
                const { res, body } = await assetApi.deleteCollection(this.deleting.id);
                if (!res.ok) throw new Error((body && body.message) || '删除失败');
                this.notify(`已删除集合「${this.deleting.name}」，其中的资源未受影响`);
                this.deleting = null;
                await this.load();
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '删除失败'), true);
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.col-page { padding: 8px 0 40px; }

.col-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 22px;
}

.col-title {
    margin: 0 0 6px;
    font-size: var(--font-size-xl);
    color: var(--text-primary);
}

.col-desc {
    margin: 0;
    max-width: 66ch;
    font-size: var(--font-size-sm);
    line-height: 1.65;
    color: var(--text-secondary);
}

.col-desc strong { color: var(--text-primary); font-weight: 600; }

.col-head-actions { display: flex; gap: 10px; flex-shrink: 0; }

.col-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
}

.col-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    background: var(--panel-background);
    overflow: hidden;
    transition: background var(--duration-fast) var(--ease-out);
}

.col-card:hover { background: var(--panel-background-hover); }

.col-card-main {
    display: block;
    padding: 16px 16px 12px;
    text-decoration: none;
    color: inherit;
    flex: 1;
}

.col-card-top { display: flex; align-items: center; gap: 9px; }

.col-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    border: 1px solid var(--accent-border);
    color: var(--accent);
    flex-shrink: 0;
}

.col-name {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.col-card-desc {
    margin: 9px 0 0;
    font-size: var(--font-size-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.col-card-meta {
    margin: 10px 0 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
}

.col-card-meta strong { color: var(--text-secondary); font-weight: 600; }

.col-card-actions {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--panel-border);
}

.col-field { display: block; margin-bottom: 12px; }

.col-label {
    display: block;
    margin-bottom: 5px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
}

.col-textarea { resize: vertical; font-family: inherit; }

.col-message {
    margin: 16px 0 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--success-soft);
    border: 1px solid var(--panel-border);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
}

.col-message.is-error { background: var(--danger-soft); }

.state-loading,
.state-error,
.empty-state { padding: 48px 0; text-align: center; color: var(--text-secondary); }

.empty-title { margin: 0 0 6px; font-size: var(--font-size-md); color: var(--text-primary); }
.empty-desc { margin: 0 0 14px; font-size: var(--font-size-sm); color: var(--text-tertiary); }
</style>
