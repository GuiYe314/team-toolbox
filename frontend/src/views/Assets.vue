<template>
    <div class="am-page">
        <!-- ═══ 页头 ═══ -->
        <header class="am-head">
            <div>
                <h1 class="am-title">资源管理</h1>
                <p class="am-desc">
                    <template v-if="trashMode">
                        回收站 · <strong>{{ total }}</strong> 项待清理
                    </template>
                    <template v-else>
                        <strong>{{ total }}</strong> 个资源<template v-if="currentFolder"> · {{ currentFolder.name }}</template>
                    </template>
                </p>
            </div>
            <div class="am-head-actions">
                <button class="btn btn-primary" type="button" @click="pickFiles">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    上传资源
                </button>
                <button class="btn" type="button" @click="createFolder">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6.5h18v4H3z" />
                        <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                    </svg>
                    新建文件夹
                </button>
                <!-- 集合：跨目录的资源编组，与文件夹互补（一个资源可属多个集合） -->
                <router-link class="btn" to="/assets/collections" title="跨目录的资源编组">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
                        <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
                    </svg>
                    集合
                </router-link>

                <!-- 导入 / 导出 / 存储路径 -->
                <div class="am-io-group">
                    <button
                        v-hint
                        class="btn btn-sm am-io-btn"
                        type="button"
                        title="导入资源包（ZIP）"
                        aria-label="导入资源包"
                        @click="pickImportPackage"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 15.5v-11" />
                            <polyline points="7.5 8.5 12 4 16.5 8.5" />
                            <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
                        </svg>
                    </button>
                    <button
                        v-hint
                        class="btn btn-sm am-io-btn"
                        type="button"
                        title="导出所选资源为 ZIP"
                        aria-label="导出所选资源"
                        :disabled="selectedIds.length === 0"
                        @click="exportSelected"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3.5v11" />
                            <polyline points="7.5 10.5 12 15 16.5 10.5" />
                            <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
                        </svg>
                    </button>
                    <button
                        v-hint
                        class="btn btn-sm am-io-btn"
                        type="button"
                        title="设置资源保存路径"
                        aria-label="设置资源保存路径"
                        @click="showStorage = true"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6.5h18v4H3z" />
                            <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                            <path d="M10 14.2h4" />
                        </svg>
                    </button>
                    <!-- 页面二维码：扫后用手机打开当前页面 -->
                    <button
                        v-hint
                        class="btn btn-sm am-io-btn"
                        type="button"
                        title="生成二维码，在手机上打开本页"
                        aria-label="生成页面二维码"
                        @click="qrMode = 'page'"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                            <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                            <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                            <path d="M14 14v3M14 20.5h.01M17.5 14h3v3h-3zM17.5 20.5h.01M20.5 17.5h.01" />
                        </svg>
                    </button>
                </div>

                <input ref="fileInput" class="am-hidden-file" type="file" multiple @change="onFilesPicked" />
                <input ref="importInput" class="am-hidden-file" type="file" accept=".zip,application/zip" @change="onImportPackage" />
            </div>
        </header>

        <!-- ═══ 工具栏 ═══ -->
        <div class="am-toolbar">
            <div class="am-search">
                <span class="am-search-icon">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" />
                        <line x1="16" y1="16" x2="20.5" y2="20.5" />
                    </svg>
                </span>
                <input
                    v-model="search"
                    class="input am-search-input"
                    type="search"
                    placeholder="搜索名称、标签、描述…"
                    @input="onSearchInput"
                />
                <button v-if="search" class="am-search-clear" type="button" aria-label="清除搜索" @click="clearSearch">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                </button>
            </div>

            <!-- 筛选/排序变化必须显式触发重新加载：
     v-model 只改数据，不会自动调 load()。
     watch 也能做，但这里直接绑 @change 更直白，且能顺手重置分页。 -->
<select v-model="typeFilter" class="am-select" aria-label="类型筛选" @change="reload">
                <option v-for="t in TYPE_FILTERS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>

            <select v-model="statusFilter" class="am-select" aria-label="状态筛选" @change="reload">
                <option v-for="s in STATUS_FILTERS" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>

            <select v-model="sort" class="am-select" aria-label="排序字段" @change="reload">
                <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">按{{ o.label }}</option>
            </select>

            <button class="btn btn-sm" type="button" @click="toggleOrder">
                {{ order === 'asc' ? '升序' : '降序' }}
            </button>

            <span class="am-toolbar-spacer"></span>

            <!--
              批量模式开关。

              设计取舍：复选框**默认隐藏**，只有点这个按钮才进入批量模式。
              原因：资源管理的主流程是「浏览 + 单个操作」，复选框常驻会
              让每行都多一个视觉噪点（截图里能明显看到 14 个空框抢注意力），
              还会让「点击行 = 打开详情」这条主路径变得含义模糊。
              进入批量模式后才出现复选框与批量操作条。
            -->
            <button
                v-hint
                class="btn btn-sm am-batch-toggle"
                :class="{ 'is-on': batchMode }"
                type="button"
                :aria-pressed="String(batchMode)"
                title="批量选择"
                aria-label="批量选择"
                @click="toggleBatchMode"
            >
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
                    <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
                    <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
                    <path d="M6 7l1.2 1.2L9.5 6" />
                    <path d="M16 7l1.2 1.2L19.5 6" />
                    <path d="M6 17l1.2 1.2L9.5 16" />
                    <path d="M16 17l1.2 1.2L19.5 16" />
                </svg>
                批量
            </button>

            <div class="am-segment" role="group" aria-label="视图切换">
                <button
                    class="am-seg-item am-seg-icon"
                    :class="{ 'is-on': view === 'list' }"
                    type="button"
                    title="列表视图"
                    aria-label="列表视图"
                    @click="view = 'list'"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="9" y1="6.5" x2="20" y2="6.5" /><line x1="9" y1="12" x2="20" y2="12" />
                        <line x1="9" y1="17.5" x2="20" y2="17.5" /><circle cx="4.8" cy="6.5" r="1.2" />
                        <circle cx="4.8" cy="12" r="1.2" /><circle cx="4.8" cy="17.5" r="1.2" />
                    </svg>
                </button>
                <button
                    class="am-seg-item am-seg-icon"
                    :class="{ 'is-on': view === 'grid' }"
                    type="button"
                    title="网格视图"
                    aria-label="网格视图"
                    @click="view = 'grid'"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="7" height="7" rx="1.4" />
                        <rect x="13" y="4" width="7" height="7" rx="1.4" />
                        <rect x="4" y="13" width="7" height="7" rx="1.4" />
                        <rect x="13" y="13" width="7" height="7" rx="1.4" />
                    </svg>
                </button>
            </div>
        </div>

        <!-- ═══ 批量操作条（仅批量模式显示）═══ -->
        <div v-if="batchMode" class="am-selbar">
            <span class="am-sel-count">已选择 {{ selectedIds.length }} 项</span>
            <button class="btn btn-sm" type="button" @click="batchDownload">
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v10" /><polyline points="8 11 12 15 16 11" /><path d="M5 19h14" />
                </svg>
                批量下载
            </button>
            <button class="btn btn-sm" type="button" @click="batchMove">移动</button>
            <button class="btn btn-sm" type="button" @click="batchTag">添加标签</button>
            <button v-if="!trashMode" class="btn btn-sm" type="button" @click="batchAddToCollection">加入集合</button>
            <button v-if="trashMode" class="btn btn-sm" type="button" @click="batchRestore">恢复</button>
            <button class="btn btn-sm btn-danger" type="button" @click="trashMode ? batchPurge() : batchDelete()">
                {{ trashMode ? '永久删除' : '删除' }}
            </button>
            <span class="am-sel-spacer"></span>
            <button class="btn btn-sm btn-ghost" type="button" @click="clearSelection">取消选择</button>
        </div>

        <!-- ═══ 主体 ═══ -->
        <div class="am-body">
            <!-- ── 左：视图导航 + 文件夹树 ── -->
            <aside class="am-side" aria-label="资源导航">
                <nav class="am-nav">
                    <button
                        v-for="v in VIEWS"
                        :key="v.key"
                        class="am-nav-item"
                        :class="{ 'is-on': viewKey === v.key && folderId === undefined }"
                        type="button"
                        @click="setView(v.key)"
                    >
                        <span class="am-nav-icon">
                            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path v-for="(d, i) in v.paths" :key="i" :d="d" />
                            </svg>
                        </span>
                        <span class="am-nav-label">{{ v.label }}</span>
                        <span v-if="stats[v.countKey] != null" class="am-nav-count">{{ stats[v.countKey] }}</span>
                    </button>
                </nav>

                <!-- 未分类：不属于任何文件夹的资源 -->
                <button
                    class="am-nav-item"
                    :class="{ 'is-on': folderId === 'none' }"
                    type="button"
                    @click="showUnclassified"
                >
                    <span class="am-nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6.5h18v4H3z" />
                            <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                            <line x1="12" y1="13.5" x2="16" y2="13.5" />
                        </svg>
                    </span>
                    <span class="am-nav-label">未分类</span>
                </button>

                <div class="am-side-sep"></div>

                <div class="am-side-head">
                    <h2 class="am-side-title">文件夹</h2>
                    <button
                        v-hint
                        class="am-vbtn"
                        type="button"
                        title="新建顶级文件夹"
                        aria-label="新建顶级文件夹"
                        @click="createFolder(null)"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>

                <div class="scroll-area am-tree-wrap">
                    <p v-if="folderLoading" class="am-hint">加载中…</p>
                    <p v-else-if="folderTree.length === 0" class="am-hint">还没有文件夹</p>
                    <AssetFolderTree
                        v-else
                        :nodes="folderTree"
                        :active-id="typeof folderId === 'number' ? folderId : null"
                        :expanded="expandedFolders"
                        :renaming-id="renamingFolderId"
                        @open="openFolder"
                        @toggle="toggleFolder"
                        @create-child="createFolder"
                        @menu="openFolderMenu"
                        @rename-submit="submitFolderRename"
                        @rename-cancel="renamingFolderId = null"
                        @drag-over="onFolderDragOver"
                        @drop="onFolderDrop"
                    />
                </div>

                <button class="btn am-side-add" type="button" @click="createFolder(null)">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    新建文件夹
                </button>
            </aside>

            <!-- ── 中：列表 / 网格 ── -->
            <div class="am-list-wrap">
                <div v-if="dragging" class="am-dropzone-hint">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 16V5" /><polyline points="7.5 9.5 12 5 16.5 9.5" /><path d="M4.5 19h15" />
                    </svg>
                    松开以上传到当前文件夹
                </div>

                <p v-if="error" class="notice notice-error am-error">
                    {{ error }}
                    <button class="nt-link" type="button" @click="load">重试</button>
                </p>

                <!-- 导入 / 导出的结果提示 -->
                <p v-if="ioMessage" class="notice am-io-msg" :class="ioError ? 'notice-error' : 'notice-success'">
                    {{ ioMessage }}
                </p>

                <!-- 加载 / 空态 -->
                <div v-if="loading && items.length === 0" class="am-empty">
                    <p>加载中…</p>
                </div>
                <div v-else-if="items.length === 0" class="am-empty">
                    <svg class="icon icon-lg am-empty-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6.5h18v4H3z" />
                        <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                        <path d="M12 13v5M9.5 15.5 12 18l2.5-2.5" />
                    </svg>
                    <p v-if="search">没有匹配「{{ search }}」的资源</p>
                    <p v-else-if="trashMode">回收站是空的</p>
                    <p v-else>这里还没有资源</p>
                    <p class="am-hint">点击右上角「上传资源」或把文件拖进来</p>
                </div>

                <!-- List 视图 -->
                <div v-else-if="view === 'list'" class="am-table-wrap">
                    <table class="am-table">
                        <thead>
                            <tr>
                                <!-- 复选框列：仅批量模式显示 -->
                                <th v-if="batchMode" class="am-td-check">
                                    <input
                                        class="am-check"
                                        type="checkbox"
                                        :checked="allSelected"
                                        :indeterminate.prop="someSelected && !allSelected"
                                        aria-label="全选"
                                        @change="toggleSelectAll"
                                    />
                                </th>
                                <th class="am-th-sortable" @click="sortBy('name')">
                                    <span class="am-th-inner">资源名称 <span v-if="sort === 'name'" class="am-sort-mark">{{ order === 'asc' ? '↑' : '↓' }}</span></span>
                                </th>
                                <th>类型</th>
                                <th class="am-td-num">大小</th>
                                <th>版本</th>
                                <th>状态</th>
                                <th>上传者</th>
                                <th class="am-th-sortable" @click="sortBy('updated_at')">
                                    <span class="am-th-inner">更新时间 <span v-if="sort === 'updated_at'" class="am-sort-mark">{{ order === 'asc' ? '↑' : '↓' }}</span></span>
                                </th>
                                <th class="am-td-act"></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="a in items"
                                :key="a.id"
                                :class="{ 'is-selected': selectedIds.includes(a.id) }"
                                :tabindex="0"
                                @click="onRowClick(a)"
                                @dblclick="openPreview(a)"
                                @contextmenu.prevent="openRowMenu(a, $event)"
                            >
                                <td v-if="batchMode" class="am-td-check" @click.stop>
                                    <input
                                        class="am-check"
                                        type="checkbox"
                                        :checked="selectedIds.includes(a.id)"
                                        :aria-label="'选择 ' + a.name"
                                        @change="toggleSelect(a.id)"
                                    />
                                </td>
                                <td class="am-td-name">
                                    <span class="am-name-cell">
                        <span class="am-thumb">
                            <img
                                v-if="isThumbOk(a)"
                                :src="thumbUrl(a)"
                                :alt="a.name"
                                @error="markThumbFail(a.id)"
                            />
                            <svg v-else class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                <path v-for="(d, i) in typeMeta(a.type).paths" :key="i" :d="d" />
                            </svg>
                            <!-- 预览生成中：角标提示，避免用户以为「图裂了」 -->
                            <span v-if="a.previewStatus === 'pending' || a.previewStatus === 'processing'"
                                  class="am-thumb-spin"
                                  title="正在生成预览"></span>
                        </span>
                                        <span class="am-name-text" :title="a.name">{{ a.name }}</span>
                                    </span>
                                </td>
                                <td>{{ typeMeta(a.type).label }}</td>
                                <td class="am-td-num">{{ formatSize(a.latestSize) }}</td>
                                <td>
                                    <span class="am-ver am-ver-latest" v-if="a.latestVersionNumber">v{{ a.latestVersionNumber }}</span>
                                    <span class="am-ver am-ver-pub" v-if="a.publishedVersionNumber">发布 v{{ a.publishedVersionNumber }}</span>
                                </td>
                                <td>
                                    <span class="am-ver" :class="'am-ver-' + (ASSET_STATUS[a.status]?.tone || 'neutral')">
                                        {{ ASSET_STATUS[a.status]?.label || a.status }}
                                    </span>
                                </td>
                                <td>{{ a.createdBy }}</td>
                                <td class="am-td-num">{{ formatRelative(a.updatedAt) }}</td>
                                <td class="am-td-act" @click.stop>
                                    <!-- 资源二维码：扫后手机直接下载该文件 -->
                                    <button
                                        v-hint
                                        class="am-vbtn"
                                        type="button"
                                        title="生成下载二维码"
                                        aria-label="生成下载二维码"
                                        @click="openQr(a)"
                                    >
                                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                            <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                                            <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                                            <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                                            <path d="M14 14v3M14 20.5h.01M17.5 14h3v3h-3zM17.5 20.5h.01M20.5 17.5h.01" />
                                        </svg>
                                    </button>
                                    <button
                                        v-hint
                                        class="am-vbtn"
                                        type="button"
                                        title="更多操作"
                                        aria-label="更多操作"
                                        @click="openRowMenu(a, $event)"
                                    >
                                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                            <circle cx="12" cy="5" r="1.4" />
                                            <circle cx="12" cy="12" r="1.4" />
                                            <circle cx="12" cy="19" r="1.4" />
                                        </svg>
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Grid 视图 -->
                <div v-else class="am-grid">
                    <div
                        v-for="a in items"
                        :key="a.id"
                        class="am-card"
                        :class="{ 'is-selected': selectedIds.includes(a.id) }"
                        :tabindex="0"
                        @click="onRowClick(a)"
                        @dblclick="openPreview(a)"
                        @contextmenu.prevent="openRowMenu(a, $event)"
                    >
                        <div class="am-card-media">
                            <!-- 复选框：仅批量模式显示 -->
                            <input
                                v-if="batchMode"
                                class="am-check am-card-check"
                                type="checkbox"
                                :checked="selectedIds.includes(a.id)"
                                :aria-label="'选择 ' + a.name"
                                @click.stop
                                @change="toggleSelect(a.id)"
                            />
                            <img
                                v-if="isThumbOk(a)"
                                :src="thumbUrl(a)"
                                :alt="a.name"
                                @error="markThumbFail(a.id)"
                            />
                            <svg v-else class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                                <path v-for="(d, i) in typeMeta(a.type).paths" :key="i" :d="d" />
                            </svg>
                            <!-- 视频加播放标志：一眼区分可播放资源 -->
                            <span v-if="a.type === 'video'" class="am-card-play">
                                <svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M8 5.5v13l11-6.5z" />
                                </svg>
                            </span>
                            <!-- 悬浮操作：扫码下载 -->
                            <button
                                v-hint
                                class="am-card-qr"
                                type="button"
                                title="生成下载二维码"
                                aria-label="生成下载二维码"
                                @click.stop="openQr(a)"
                            >
                                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                                    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                                    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                                    <path d="M14 14v3M14 20.5h.01M17.5 14h3v3h-3zM17.5 20.5h.01M20.5 17.5h.01" />
                                </svg>
                            </button>
                        </div>
                        <div class="am-card-body">
                            <span class="am-card-title" :title="a.name">{{ a.name }}</span>
                            <div class="am-card-meta">
                                <span>{{ typeMeta(a.type).label }}</span>
                                <span>{{ formatSize(a.latestSize) }}</span>
                            </div>
                            <div class="am-card-meta">
                                <span class="am-ver am-ver-latest" v-if="a.latestVersionNumber">v{{ a.latestVersionNumber }}</span>
                                <span class="am-ver am-ver-pub" v-if="a.publishedVersionNumber">发布 v{{ a.publishedVersionNumber }}</span>
                                <span>{{ formatRelative(a.updatedAt) }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 分页 -->
                <div v-if="items.length > 0 && total > pageSize" class="am-pager">
                    <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 项</span>
                    <div class="am-pager-btns">
                        <button class="btn btn-sm" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
                        <button class="btn btn-sm" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
                    </div>
                </div>
            </div>

            <!-- ── 右：详情（窄屏由 CSS 转抽屉） ── -->
            <AssetDetails
                v-if="showDetail"
                :asset="detail"
                :versions="detailVersions"
                :versions-loading="detailLoading"
                :can-preview="detail ? hasPreviewProvider(detail.type) : false"
                :is-trash-view="trashMode"
                :busy="actionBusy"
                @close="detailId = null"
                @preview="openPreview"
                @upload-new="startVersionUpload"
                @rename="startRename"
                @move="startMove"
                @remove="trashMode ? confirmPurgeOne() : confirmDeleteOne()"
                @refresh="onDetailAction"
            />
        </div>

        <!-- 窄屏详情抽屉的遮罩 -->
        <div v-if="showDetail && isNarrow" class="am-detail-backdrop" @click="detailId = null"></div>

        <!-- ═══ 预览弹窗 ═══ -->
        <AssetPreviewDialog
            v-if="previewAsset"
            :asset="previewAsset"
            :versions="previewVersions"
            :siblings="items"
            @close="previewAsset = null"
            @navigate="onPreviewNavigate"
            @versions-loaded="previewVersions = $event"
        />

        <!--
          ═══ 右键菜单 ═══

          用 Teleport 挂到 body —— 这不是「为了让 DOM 扁平」，而是**必须**：

          .main-content 上有 backdrop-filter: blur(30px)（玻璃拟态），
          而 backdrop-filter / filter / transform 都会创建**包含块**，
          使得后代的 position: fixed 改为相对该元素定位、而非相对视口。

          后果：菜单的 left 是按视口坐标算的（如 1397px），
          实际却渲染在 main-content 偏移（250px）之后 → 1648px，
          整个菜单跑到视口外，用户完全看不到。

          挂到 body 后 fixed 相对视口，坐标才对。
        -->
        <Teleport to="body">
            <div
                v-if="menu"
                ref="rowMenuEl"
                class="dropdown am-menu"
                role="menu"
                :style="menuStyle('menu')"
                @mouseleave="menu = null"
            >
                <button type="button" role="menuitem" @click="menuAction('preview')">预览</button>
                <button type="button" role="menuitem" @click="menuAction('download')">下载</button>
                <button type="button" role="menuitem" @click="menuAction('upload-new')">上传新版本</button>
                <button type="button" role="menuitem" @click="menuAction('publish')">发布最新版本</button>
                <button type="button" role="menuitem" @click="menuAction('rename')">重命名</button>
                <button type="button" role="menuitem" @click="menuAction('move')">移动到…</button>
                <div class="dd-sep"></div>
                <button class="dd-danger" type="button" role="menuitem" @click="menuAction('delete')">
                    {{ trashMode ? '永久删除' : '移入回收站' }}
                </button>
            </div>
        </Teleport>

        <!-- ═══ 文件夹右键菜单 ═══ -->
        <!-- 同样 Teleport 到 body —— 原因见上方右键菜单的注释 -->
        <Teleport to="body">
            <div
                v-if="folderMenu"
                ref="folderMenuEl"
                class="dropdown am-menu"
                role="menu"
                :style="menuStyle('folderMenu')"
                @mouseleave="folderMenu = null"
            >
                <button type="button" role="menuitem" @click="folderMenuAction('open')">打开</button>
                <button type="button" role="menuitem" @click="folderMenuAction('child')">新建子文件夹</button>
                <button type="button" role="menuitem" @click="folderMenuAction('rename')">重命名</button>
                <div class="dd-sep"></div>
                <button class="dd-danger" type="button" role="menuitem" @click="folderMenuAction('delete')">删除文件夹</button>
            </div>
        </Teleport>

        <!-- ═══ 通用输入弹窗（重命名 / 新建文件夹 / 移动 / 标签） ═══ -->
        <!-- Teleport 到 body：.main-content 上的 backdrop-filter 会创建包含块，
             使 position: fixed 相对该元素而非视口定位，遮罩就只盖住主内容区。 -->
        <Teleport to="body">
            <div v-if="prompt" class="overlay" @click.self="prompt = null">
            <div class="dialog" role="dialog" aria-modal="true">
                <h2 class="dialog-title">{{ prompt.title }}</h2>
                <p v-if="prompt.hint" class="dialog-text">{{ prompt.hint }}</p>

                <select v-if="prompt.kind === 'folder'" v-model="prompt.value" class="am-select am-prompt-select">
                    <option :value="null">未分类（根目录）</option>
                    <option v-for="f in folderTree" :key="f.id" :value="f.id">{{ '　'.repeat(f.depth) }}{{ f.name }}</option>
                </select>
                <input
                    v-else
                    v-model="prompt.value"
                    class="input am-prompt-input"
                    type="text"
                    :placeholder="prompt.placeholder || ''"
                    @keyup.enter="submitPrompt"
                />
                <p v-if="promptError" class="notice notice-error am-prompt-error">{{ promptError }}</p>

                <div class="dialog-actions">
                    <button class="btn" type="button" @click="prompt = null">取消</button>
                    <button class="btn btn-primary" type="button" @click="submitPrompt">{{ prompt.okText || '确定' }}</button>
                </div>
            </div>
            </div>
        </Teleport>

        <!-- ═══ 永久删除二次确认 ═══ -->
        <Teleport to="body">
            <div v-if="confirm" class="overlay" @click.self="confirm = null">
            <div class="dialog" role="dialog" aria-modal="true">
                <h2 class="dialog-title">{{ confirm.title }}</h2>
                <p class="dialog-text">{{ confirm.text }}</p>
                <p class="dialog-warn">{{ confirm.warn }}</p>
                <div class="dialog-actions">
                    <button class="btn" type="button" @click="confirm = null">取消</button>
                    <button class="btn btn-danger-solid" type="button" @click="runConfirm">{{ confirm.okText || '确认' }}</button>
                </div>
            </div>
            </div>
        </Teleport>

        <!-- ═══ 存储路径设置 ═══ -->
        <AssetStorageSettings
            v-if="showStorage"
            @close="showStorage = false"
            @changed="load"
        />

        <!-- ═══ 二维码分享 ═══ -->
        <AssetQrDialog
            v-if="qrMode"
            :mode="qrMode"
            :asset-id="qrAsset ? qrAsset.id : null"
            :asset-name="qrAsset ? qrAsset.name : ''"
            :pointer="qrPointer"
            @close="qrMode = null; qrAsset = null"
        />

        <!-- ═══ 右下角上传任务面板 ═══ -->
        <AssetUploadPanel
            :items="uploadItems"
            @cancel="cancelUpload"
            @cancel-all="cancelAllUploads"
            @clear-finished="clearFinishedUploads"
            @resolve="resolveUploadConflict"
        />
    </div>
</template>

<script>
import assetApi from '../api/asset-client.js';
import {
    typeMeta, formatSize, formatRelative, ASSET_STATUS,
    TYPE_FILTER_ORDER, STATUS_FILTER_ORDER, SORT_OPTIONS, hasPreviewProvider
} from '../assets/asset-meta.js';
import UploadManager from '../assets/upload-manager.js';
import AssetFolderTree from '../components/assets/AssetFolderTree.vue';
import AssetDetails from '../components/assets/AssetDetails.vue';
import AssetPreviewDialog from '../components/assets/AssetPreviewDialog.vue';
import AssetUploadPanel from '../components/assets/AssetUploadPanel.vue';
import AssetStorageSettings from '../components/assets/AssetStorageSettings.vue';
import AssetQrDialog from '../components/assets/AssetQrDialog.vue';

const EXPANDED_KEY = 'asset-folders-expanded';
const PAGE_SIZE = 50;

export default {
    name: 'AssetsView',
    components: { AssetFolderTree, AssetDetails, AssetPreviewDialog, AssetUploadPanel, AssetStorageSettings, AssetQrDialog },
    data() {
        return {
            // ── 列表状态 ──
            items: [],
            total: 0,
            page: 1,
            pageSize: PAGE_SIZE,
            loading: false,
            error: '',
            stats: {},

            // ── 筛选 / 排序 ──
            search: '',
            typeFilter: 'all',
            statusFilter: 'all',
            sort: 'updated_at',
            order: 'desc',
            viewKey: 'all',
            /** undefined = 跨文件夹（全部）；'none' = 未分类；数字 = 指定文件夹 */
            folderId: undefined,

            // ── 视图模式 ──
            view: localStorage.getItem('asset-view') || 'list',

            // ── 选择 ──
            selectedIds: [],
            /**
             * 批量模式开关。
             * 只有开启时才显示复选框列与批量操作条；
             * 关闭时清空选择（见 toggleBatchMode）。
             */
            batchMode: false,

            // ── 文件夹 ──
            folderTree: [],
            folderLoading: false,
            expandedFolders: {},
            renamingFolderId: null,

            // ── 详情 ──
            detailId: null,
            detail: null,
            detailVersions: [],
            detailLoading: false,
            actionBusy: false,

            // ── 预览 ──
            previewAsset: null,
            previewVersions: [],

            // ── 菜单 ──
            menu: null,
            folderMenu: null,

            // ── 弹窗 ──
            prompt: null,
            promptError: '',
            confirm: null,

            // ── 上传 ──
            uploadItems: [],
            dragging: false,

            // ── 存储路径设置 ──
            showStorage: false,

            // ── 二维码分享 ──
            // qrMode: null | 'page' | 'asset'
            qrMode: null,
            qrAsset: null,
            // 下载哪个版本：已发布优先（对外正式版本），否则最新
            qrPointer: 'latest',

            // ── 导入 / 导出状态 ──
            ioBusy: false,
            ioMessage: '',
            ioError: false,

            // ── 缩略图失败缓存（避免每次渲染重试 404） ──
            thumbFailed: {},

            isNarrow: window.innerWidth <= 1180,
            TYPE_FILTERS: [{ value: 'all', label: '全部类型' },
                ...TYPE_FILTER_ORDER.filter((t) => t !== 'all').map((t) => ({
                    value: t, label: typeMeta(t).label
                }))],
            STATUS_FILTERS: [{ value: 'all', label: '全部状态' },
                ...STATUS_FILTER_ORDER.filter((s) => s !== 'all').map((s) => ({
                    value: s, label: ASSET_STATUS[s].label
                }))],
            SORT_OPTIONS,
            ASSET_STATUS,
            // 左侧导航项：countKey 对应后端 stats 的字段
            VIEWS: [
                {
                    key: 'all', label: '全部资源', countKey: 'active',
                    paths: ['M4 5.5h6.5l1.5 2H20v11.5H4z']
                },
                {
                    key: 'recent', label: '最近使用', countKey: null,
                    paths: ['M12 4.5v7.5l3 2', 'M12 20.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16z']
                },
                {
                    key: 'mine', label: '我的上传', countKey: null,
                    paths: ['M12 11.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M4.5 20.2a7.5 7.5 0 0 1 15 0']
                },
                {
                    key: 'published', label: '已发布', countKey: 'published',
                    paths: ['M5 12.5l4.5 4.5L19 7.5']
                },
                {
                    key: 'trash', label: '回收站', countKey: 'trashed',
                    paths: ['M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7',
                        'M6.5 6.5l.8 12.2A1.6 1.6 0 0 0 8.9 20.2h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12.2']
                }
            ]
        };
    },
    computed: {
        trashMode() { return this.viewKey === 'trash'; },
        /**
         * 是否只看待整理的「未分类」资源。
         * 用独立开关而不是把 folderId 设成 null —— 因为 null 在 API 层
         * 有「未分类」的特定含义，若同时又当默认值，「看全部」会被误伤成「看未分类」。
         */
        unclassifiedOnly() { return this.folderId === 'none'; },
        showDetail() { return this.detailId != null; },
        totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
        allSelected() {
            return this.items.length > 0 && this.selectedIds.length === this.items.length;
        },
        someSelected() {
            return this.selectedIds.length > 0 && !this.allSelected;
        },
        /** 面包屑用的当前文件夹名。 */
        currentFolder() {
            if (this.folderId == null) return null;
            return this.flattenFolders().find((f) => f.id === this.folderId) || null;
        }
    },
    created() {
        // 上传管理器是长生命周期对象：创建一次，全组件共享，
        // 组件卸载时必须 destroy（否则 Uppy 的事件监听会泄漏）
        this._upload = new UploadManager({ assetApi });
        this._unsubUpload = this._upload.subscribe((items) => {
            this.uploadItems = items.slice();
            // 有新资产入库时刷新列表，让用户立刻看到结果
            if (items.some((i) => i.state === 'success')) this.load();
            if (items.some((i) => i.state === 'needs_decision') && this._conflictShown !== items.find((i) => i.state === 'needs_decision').id) {
                this._conflictShown = items.find((i) => i.state === 'needs_decision').id;
            }
        });
        this.loadExpanded();
    },
    async mounted() {
        window.addEventListener('resize', this.onResize);
        this.loadFolders();
        await this.loadStats();
        await this.load();
        if (this.detailId) await this.loadDetail();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.onResize);
        // 事件解绑：拖拽监听挂在 window 上，不摘会持续触发
        window.removeEventListener('dragover', this.onWindowDragOver);
        window.removeEventListener('dragleave', this.onWindowDragLeave);
        window.removeEventListener('drop', this.onWindowDrop);
        if (this._unsubUpload) this._unsubUpload();
        if (this._upload) this._upload.destroy();
    },
    methods: {
        typeMeta,
        formatSize,
        formatRelative,
        hasPreviewProvider,

        onResize() {
            this.isNarrow = window.innerWidth <= 1180;
        },

        // ── 数据加载 ──
        async load() {
            this.loading = true;
            this.error = '';
            try {
                const { res, body } = await assetApi.list({
                    // folderId 三态：undefined=不限；null=未分类；数字=指定
                    // 顶部导航视图（全部/最近/我的/已发布）都应「跨文件夹看」，
                    // 所以传 undefined；只有点「未分类」才传 null。
                    folderId: this.unclassifiedOnly ? null : this.folderId,
                    search: this.search.trim(),
                    type: this.typeFilter,
                    status: this.statusFilter,
                    scope: this.trashMode ? 'trash' : (this.viewKey === 'published' ? 'published' : 'all'),
                    sort: this.sort,
                    order: this.order,
                    page: this.page,
                    pageSize: this.pageSize
                });
                if (!res.ok) throw new Error((body && body.message) || '加载失败');
                this.items = (body && body.items) || [];
                this.total = (body && body.total) || 0;
                this.pruneSelection();
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '加载失败');
            } finally {
                this.loading = false;
            }
        },
        async loadStats() {
            try {
                const { res, body } = await assetApi.stats();
                if (res.ok) this.stats = body || {};
            } catch {
                // 统计失败不影响主流程，导航徽标留空即可
            }
        },
        async loadDetail() {
            if (this.detailId == null) {
                this.detail = null;
                this.detailVersions = [];
                return;
            }
            this.detailLoading = true;
            try {
                const { res, body } = await assetApi.get(this.detailId);
                if (!res.ok) throw new Error((body && body.message) || '加载详情失败');
                this.detail = body;
                this.detailVersions = body.versions || [];
            } catch (e) {
                this.error = e.message || '加载详情失败';
                this.detailId = null;
            } finally {
                this.detailLoading = false;
            }
        },
        async loadFolders() {
            this.folderLoading = true;
            try {
                const { res, body } = await assetApi.listFolders();
                if (res.ok) this.folderTree = this.buildTree((body && body.items) || []);
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '文件夹加载失败');
            } finally {
                this.folderLoading = false;
            }
        },

        /** 扁平行 → 嵌套树。父级缺失的行降级为顶层，避免整棵树消失。 */
        buildTree(rows) {
            const map = new Map();
            for (const r of rows) map.set(r.id, { ...r, children: [] });
            const roots = [];
            for (const r of rows) {
                const node = map.get(r.id);
                const parent = r.parent_id != null ? map.get(r.parent_id) : null;
                if (parent && parent !== node) parent.children.push(node);
                else roots.push(node);
            }
            // 给每个节点标深度，供「移动到」下拉缩进显示
            const mark = (list, depth) => list.forEach((n) => { n.depth = depth; mark(n.children, depth + 1); });
            mark(roots, 0);
            return roots;
        },
        /** 树 → 扁平，供面包屑与移动下拉使用。 */
        flattenFolders(list = this.folderTree, out = []) {
            for (const n of list) {
                out.push(n);
                this.flattenFolders(n.children, out);
            }
            return out;
        },

        loadExpanded() {
            try {
                const raw = localStorage.getItem(EXPANDED_KEY);
                if (raw) this.expandedFolders = JSON.parse(raw) || {};
            } catch {
                this.expandedFolders = {};
            }
        },
        saveExpanded() {
            try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(this.expandedFolders)); }
            catch { /* 不可用时忽略，仅影响折叠记忆 */ }
        },

        // ── 视图 / 筛选 ──
        setView(key) {
            this.viewKey = key;
            // 顶部视图一律跨文件夹；用 undefined 而非 null（null = 未分类）
            this.folderId = undefined;
            this.page = 1;
            this.clearSelection();
            this.load();
        },
        /** 只看未分类资源。 */
        showUnclassified() {
            this.viewKey = 'all';
            this.folderId = 'none';
            this.page = 1;
            this.clearSelection();
            this.load();
        },
        openFolder(node) {
            this.folderId = node.id;
            this.viewKey = 'all';
            this.page = 1;
            this.clearSelection();
            this.load();
        },
        sortBy(field) {
            if (this.sort === field) this.order = this.order === 'asc' ? 'desc' : 'asc';
            else { this.sort = field; this.order = 'desc'; }
            this.page = 1;
            this.load();
        },
        /** 筛选/排序变化后重新加载（重置到第一页）。 */
        reload() {
            this.page = 1;
            this.clearSelection();
            this.load();
        },
        /** 切换升降序并重新加载。 */
        toggleOrder() {
            this.order = this.order === 'asc' ? 'desc' : 'asc';
            this.reload();
        },
        /**
         * 切换批量模式。
         *
         * 退出时清空已选 —— 留着选择会让用户下次进入批量模式时
         * 看到「已选择 N 项」却不知道选的是什么，误操作风险高。
         */
        toggleBatchMode() {
            this.batchMode = !this.batchMode;
            if (!this.batchMode) this.clearSelection();
        },
        onSearchInput() {
            // 防抖 300ms，避免每敲一个字就打一次接口
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => {
                this.page = 1;
                this.load();
            }, 300);
        },
        clearSearch() {
            this.search = '';
            this.page = 1;
            this.load();
        },
        goPage(p) {
            this.page = Math.min(this.totalPages, Math.max(1, p));
            this.load();
        },

        // ── 选择 ──
        /**
         * 点击行。
         *
         * 两种模式语义不同：
         *  - 普通模式：打开右侧详情（主路径）
         *  - 批量模式：**只切换选中**，不开详情。
         *    否则用户勾选一批资源时详情面板会不断跳，右侧内容乱闪。
         */
        onRowClick(a) {
            if (this.batchMode) {
                this.toggleSelect(a.id);
                return;
            }
            this.detailId = a.id;
            this.loadDetail();
        },
        toggleSelect(id) {
            const i = this.selectedIds.indexOf(id);
            if (i >= 0) this.selectedIds.splice(i, 1);
            else this.selectedIds.push(id);
        },
        toggleSelectAll() {
            this.selectedIds = this.allSelected ? [] : this.items.map((a) => a.id);
        },
        clearSelection() { this.selectedIds = []; },
        pruneSelection() {
            if (this.selectedIds.length === 0) return;
            const visible = new Set(this.items.map((a) => a.id));
            this.selectedIds = this.selectedIds.filter((id) => visible.has(id));
        },

        // ── 缩略图 ──
        thumbUrl(a) {
            return assetApi.fileUrl(a.id, 'thumbnail', 'latest');
        },
        /**
         * 是否显示缩略图。
         *
         * 判断依据是**服务端是否真的生成了缩略图**（hasThumbnail），
         * 而不是「类型是不是图片」—— 后者在预览管线接入前会让
         * 每个图片都发起一次注定 404 的请求。
         */
        isThumbOk(a) {
            if (this.thumbFailed[a.id]) return false;
            return !!(a.hasThumbnail || a.thumbnailStorageKey);
        },
        markThumbFail(id) { this.thumbFailed[id] = true; },

        // ── 右键菜单 ──
        /**
         * 打开资源右键 / 更多操作菜单。
         *
         * 定位策略：**先渲染、再测量、最后定位**。
         *
         * 为什么不能像原来那样用硬编码宽度算位置：
         * 菜单宽度由内容决定（实测 188px，而代码里写的是 176px），
         * 而且按钮在表格**最右列**（x≈1589，视口宽 1700）。
         * 从按钮左边缘向右展开 188px → 右边缘 1777，直接跑到视口外，
         * 用户完全看不到菜单。
         *
         * 所以改为：先按锚点位置渲染出来，拿到真实尺寸后再夹取到视口内。
         */
        openRowMenu(a, ev) {
            // currentTarget 在事件回调结束后会变成 null，必须立即取出来
            const anchor = ev.currentTarget;
            this.menu = { asset: a, anchor, x: 0, y: 0 };
            this.folderMenu = null;
            this.$nextTick(() => this.positionMenu('menu', 'rowMenuEl'));
        },
        /**
         * 测量菜单真实尺寸并定位到视口内。
         *
         * 水平方向：**优先让菜单右边缘对齐按钮右边缘**。
         * 按钮在表格最右列，右对齐时菜单自然落在按钮左侧，不会顶出视口。
         * 若右对齐后左边缘仍小于 8px（按钮靠视口最左时），再翻到按钮右侧。
         *
         * @param {string} key      菜单状态字段名（'menu' / 'folderMenu'）
         * @param {string} refName 菜单元素的 ref 名
         */
        /**
         * 菜单定位样式。
         *
         * positioned 为 false 时先隐藏 —— 菜单要先渲染出来才能量到真实尺寸，
         * 若此时就显示在 (0,0)，用户会看到菜单「闪」到左上角再跳到位。
         */
        menuStyle(key) {
            const m = this[key];
            if (!m) return {};
            if (!m.positioned) return { visibility: 'hidden' };
            return { top: m.y + 'px', left: m.x + 'px' };
        },
        positionMenu(key, refName) {            const m = this[key];
            if (!m || !m.anchor) return;
            // 用 ref 而不是 querySelector —— 两个菜单共用 .am-menu class，
            // querySelector 只会取到第一个，量到的可能是另一个菜单的尺寸
            const el = this.$refs[refName];
            if (!el) return;

            const r = m.anchor.getBoundingClientRect();
            // 用实际渲染尺寸，不靠硬编码
            const w = el.offsetWidth || 176;
            const h = el.offsetHeight || 200;

            // 右对齐：菜单右边缘 = 按钮右边缘
            let x = r.right - w;
            // 越界则翻到按钮左侧
            if (x < 8) x = r.left;
            // 仍越界（按钮在视口边缘且菜单太宽）→ 夹取
            x = Math.max(8, Math.min(x, window.innerWidth - w - 8));

            const y = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8));
            this[key] = { ...m, x, y, positioned: true };
        },
        /**
         * 打开资源下载二维码。
         *
         * 下载哪个版本：优先「已发布版本」—— 对外分享应该给正式发布的那版，
         * 而不是还在草稿中的最新版。资源没发布过才退回 latest。
         */
        openQr(a) {
            this.qrAsset = a;
            this.qrPointer = a.publishedVersionNumber ? 'published' : 'latest';
            this.qrMode = 'asset';
        },
        openFolderMenu(node, ev) {
            const anchor = ev.currentTarget;
            this.folderMenu = { node, anchor, x: 0, y: 0 };
            this.menu = null;
            this.$nextTick(() => this.positionMenu('folderMenu', 'folderMenuEl'));
        },

        async menuAction(what) {
            const a = this.menu && this.menu.asset;
            this.menu = null;
            if (!a) return;
            if (what === 'preview') return this.openPreview(a);
            if (what === 'download') return window.open(assetApi.fileUrl(a.id, 'original', 'latest', true), '_blank');
            if (what === 'upload-new') return this.startVersionUpload(a);
            if (what === 'publish') return this.doPublish(a);
            if (what === 'rename') return this.startRename(a);
            if (what === 'move') return this.startMove(a);
            if (what === 'delete') {
                if (this.trashMode) return this.confirmPurge([a]);
                return this.confirmDelete([a]);
            }
        },
        folderMenuAction(what) {
            const node = this.folderMenu && this.folderMenu.node;
            this.folderMenu = null;
            if (!node) return;
            if (what === 'open') return this.openFolder(node);
            if (what === 'child') return this.createFolder(node.id);
            if (what === 'rename') { this.renamingFolderId = node.id; return; }
            if (what === 'delete') return this.confirmDeleteFolder(node);
        },

        // ── 文件夹 ──
        toggleFolder(id) {
            this.expandedFolders = { ...this.expandedFolders, [id]: !this.expandedFolders[id] };
            this.saveExpanded();
        },
        createFolder(parentId) {
            this.prompt = {
                kind: 'text',
                title: parentId ? '新建子文件夹' : '新建文件夹',
                placeholder: '文件夹名称',
                value: '',
                okText: '创建',
                onSubmit: async (name) => {
                    const { res, body } = await assetApi.createFolder(name, parentId);
                    if (!res.ok) throw new Error((body && body.message) || '创建失败');
                    await this.loadFolders();
                    if (parentId) {
                        this.expandedFolders = { ...this.expandedFolders, [parentId]: true };
                        this.saveExpanded();
                    }
                }
            };
        },
        submitFolderRename(node, rawName) {
            if (this.renamingFolderId !== node.id) return;
            const name = String(rawName || '').trim();
            this.renamingFolderId = null;
            if (!name || name === node.name) return;
            this.actionBusy = true;
            assetApi.renameFolder(node.id, name)
                .then(({ res }) => { if (res.ok) this.loadFolders(); })
                .catch(() => {})
                .finally(() => { this.actionBusy = false; });
        },
        confirmDeleteFolder(node) {
            const count = this.countInFolder(node.id);
            this.confirm = {
                title: '删除文件夹',
                text: `确定删除「${node.name}」吗？`,
                // 不用 Markdown 星号：这里渲染的是纯文本，** 会原样显示
                warn: count > 0
                    ? `其中的 ${count} 个资源不会被删除，会变为「未分类」。`
                    : '此操作不可撤销。',
                okText: '删除',
                action: async () => {
                    const { res, body } = await assetApi.deleteFolder(node.id);
                    if (!res.ok) throw new Error((body && body.message) || '删除失败');
                    if (this.folderId === node.id) { this.folderId = undefined; }
                    await this.loadFolders();
                    await this.load();
                }
            };
        },
        countInFolder(id) {
            let n = 0;
            const walk = (list) => list.forEach((f) => {
                if (f.id === id) n += f.assetCount || 0;
                walk(f.children);
            });
            walk(this.folderTree);
            return n;
        },

        // ── 详情 ──
        async onDetailAction({ action, version }) {
            // 预览状态轮询：静默刷新，不弹错误框、不卡按钮
            if (action === 'preview-poll') {
                await this.loadDetail();
                await this.load();
                return;
            }
            this.actionBusy = true;
            try {
                if (action === 'publish' && version) {
                    await assetApi.publish(this.detailId, version.id);
                } else if (action === 'publish') {
                    await assetApi.publish(this.detailId);
                } else if (action === 'restore' && version) {
                    // 恢复历史版本 = 复制内容生成新版本，历史不会被删
                    await assetApi.restore(this.detailId, version.id);
                } else if (action === 'delete-version' && version) {
                    await assetApi.deleteVersion(this.detailId, version.id);
                }
                await this.loadDetail();
                await this.load();
                await this.loadStats();
            } catch (e) {
                window.alert(e.message || '操作失败');
            } finally {
                this.actionBusy = false;
            }
        },

        // ── 预览 ──
        openPreview(a, version) {
            this.previewAsset = a;
            this.previewVersions = version
                ? [{ ...version, isLatest: version.isLatest }]
                : (this.detail && this.detailId === a.id ? this.detailVersions : []);
        },
        onPreviewNavigate({ asset, version }) {
            this.previewAsset = asset;
            if (version) {
                this.previewVersions = [version];
            } else {
                this.previewVersions = [];
            }
        },

        // ── 上传 ──
        pickFiles() { this.$refs.fileInput.click(); },
        onFilesPicked(e) {
            const files = e.target.files;
            if (files && files.length) this.startUpload(files);
            // 清空 value，否则同一个文件选第二次不会触发 change
            e.target.value = '';
        },
        startUpload(files, opts = {}) {
            // 'none' 是视图层的「未分类」标记，上传时该传 null（后端认 null=未分类）
            const rawFolder = opts.folderId !== undefined ? opts.folderId : this.folderId;
            const folderId = rawFolder === 'none' ? null : (rawFolder === undefined ? null : rawFolder);
            this._upload.start(files, {
                folderId,
                // 「上传新版本」场景：带上 assetId 让后端走追加版本分支，
                // 否则会被当成新资源，重名冲突弹窗就白弹了
                assetId: opts.assetId || null,
                comment: opts.comment || '',
                tags: opts.tags || ''
            });
        },
        startVersionUpload(a) {
            // 记下目标资源，用户选完文件后作为它的新版本上传
            this._versionTargetId = a.id;
            this.pickFiles();
        },
        async onFilesPicked(e) {
            const files = e.target.files;
            if (files && files.length) {
                const assetId = this._versionTargetId;
                this._versionTargetId = null;
                this.startUpload(files, assetId ? { assetId, comment: '上传新版本' } : {});
            }
            // 清空 value，否则同一个文件选第二次不会触发 change
            e.target.value = '';
        },
        cancelUpload(id) { this._upload.cancel(id); },
        cancelAllUploads() { this._upload.cancelAll(); },
        clearFinishedUploads() { this._upload.clearFinished(); },
        resolveUploadConflict(fileItemId, choice) {
            this._upload.resolveConflict(fileItemId, choice);
        },

        // ── 拖拽上传 ──
        onWindowDragOver(e) { e.preventDefault(); this.dragging = true; },
        onWindowDragLeave(e) {
            // 只有真正离开窗口才取消：relatedTarget 为 null 表示拖出了窗口
            if (!e.relatedTarget) this.dragging = false;
        },
        onWindowDrop(e) {
            e.preventDefault();
            this.dragging = false;
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                this.startUpload(e.dataTransfer.files);
            }
        },
        onFolderDragOver(node) { this._dragFolderId = node.id; },
        async onFolderDrop(node, ev) {
            const ids = ev.dataTransfer.getData('text/asset-ids');
            if (!ids) return;
            const list = ids.split(',').map(Number).filter(Boolean);
            if (list.length) {
                await this.doBatchMove(list, node.id);
                this.loadFolders();
            }
        },

        // ── 批量操作 ──
        batchDownload() {
            // 不做前端打包：大型资源全部读进内存会崩浏览器。
            // 逐个触发下载由浏览器管理并发；后续可换服务端 Streaming ZIP。
            for (const id of this.selectedIds) {
                window.open(assetApi.fileUrl(id, 'original', 'latest', true), '_blank');
            }
        },

        // ── 导出 / 导入 ──
        /**
         * 导出所选资源为 ZIP。
         * 走服务端流式打包 —— 大文件不会整个进浏览器内存。
         */
        async exportSelected() {
            if (this.selectedIds.length === 0) return;
            this.ioBusy = true;
            try {
                const r = await assetApi.exportZip(this.selectedIds);
                if (!r.ok) {
                    window.alert(r.message || '导出失败');
                    return;
                }
                // 触发浏览器下载
                const url = URL.createObjectURL(r.blob);
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                const a = document.createElement('a');
                a.href = url;
                a.download = `team-toolbox-assets-${stamp}.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                // 立即 revoke 会让部分浏览器下载中断，延后释放
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                this.ioMessage = `已导出 ${this.selectedIds.length} 个资源`;
                this.ioError = false;
                this.clearSelection();
            } catch (e) {
                this.ioError = true;
                this.ioMessage = e.message || '导出失败';
            } finally {
                this.ioBusy = false;
            }
        },

        /** 打开文件选择器选资源包。 */
        pickImportPackage() {
            if (this.$refs.importInput) this.$refs.importInput.click();
        },

        /** 导入资源包。 */
        async onImportPackage(e) {
            const file = e.target.files && e.target.files[0];
            if (e.target) e.target.value = '';   // 允许重复选同一个文件
            if (!file) return;

            this.ioBusy = true;
            this.ioMessage = '正在导入资源包…';
            this.ioError = false;
            try {
                const { res, body } = await assetApi.importZip(file);
                if (!res.ok) {
                    this.ioError = true;
                    this.ioMessage = (body && body.message) || '导入失败';
                    return;
                }
                const n = body.assets || 0;
                const v = body.versions || 0;
                const skipped = body.skipped || 0;
                this.ioMessage = `导入完成：${n} 个资源、${v} 个版本`
                    + (skipped ? `，${skipped} 项跳过` : '');
                await this.load();
                await this.loadStats();
                await this.loadFolders();
            } catch (e) {
                this.ioError = true;
                this.ioMessage = e.network ? e.message : (e.message || '导入失败');
            } finally {
                this.ioBusy = false;
            }
        },
        batchMove() {
            this.prompt = {
                kind: 'folder',
                title: `移动 ${this.selectedIds.length} 个资源`,
                // 下拉的 value 是「文件夹 id 或 null(未分类)」；
                // 视图层的 undefined/'none' 不是合法选项值，需归一
                value: this.folderId === undefined || this.folderId === 'none' ? null : this.folderId,
                okText: '移动',
                onSubmit: (folderId) => this.doBatchMove(this.selectedIds.slice(), folderId)
            };
        },
        async doBatchMove(ids, folderId) {
            const { res, body } = await assetApi.batchMove(ids, folderId);
            if (!res.ok) throw new Error((body && body.message) || '移动失败');
            await this.load();
            await this.loadFolders();
            window.alert(`已移动 ${body.moved} 个资源`);
        },
        batchTag() {
            this.prompt = {
                kind: 'text',
                title: `给 ${this.selectedIds.length} 个资源添加标签`,
                hint: '多个标签用逗号分隔',
                placeholder: '秦陵,高模,待优化',
                value: '',
                okText: '添加',
                onSubmit: async (raw) => {
                    const tags = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
                    if (tags.length === 0) throw new Error('请至少输入一个标签');
                    const { res, body } = await assetApi.batchTags(this.selectedIds, tags);
                    if (!res.ok) throw new Error((body && body.message) || '添加失败');
                    await this.load();
                    window.alert(`已为 ${body.updated} 个资源添加标签`);
                }
            };
        },
        /**
         * 把选中的资源加入集合。
         *
         * 用输入框而不是下拉选择：集合在早期往往还没建好，
         * 让用户「输入名字 → 不存在就顺手创建」比「先去别处建好再回来选」少两步。
         * 名字已存在则直接加入 —— 与标签的交互习惯一致。
         */
        batchAddToCollection() {
            const n = this.selectedIds.length;
            this.prompt = {
                kind: 'text',
                title: `把 ${n} 个资源加入集合`,
                hint: '输入集合名称：已存在则直接加入，不存在会自动创建',
                placeholder: '展会交付包',
                value: '',
                okText: '加入',
                onSubmit: async (raw) => {
                    const name = String(raw || '').trim();
                    if (!name) throw new Error('请输入集合名称');

                    // 先按名字找，找到就用；找不到再创建
                    const listed = await assetApi.listCollections();
                    if (!listed.res.ok) throw new Error((listed.body && listed.body.message) || '读取集合失败');
                    const found = ((listed.body && listed.body.items) || []).find((c) => c.name === name);

                    let cid = found ? found.id : null;
                    let createdNew = false;
                    if (!cid) {
                        const made = await assetApi.createCollection(name);
                        if (!made.res.ok) throw new Error((made.body && made.body.message) || '创建集合失败');
                        cid = made.body.id;
                        createdNew = true;
                    }

                    const r = await assetApi.addToCollection(cid, this.selectedIds);
                    if (!r.res.ok) throw new Error((r.body && r.body.message) || '加入集合失败');

                    const added = (r.body && r.body.added) || 0;
                    const skipped = (r.body && r.body.skipped) || 0;
                    let msg = createdNew
                        ? `已创建集合「${name}」并加入 ${added} 个资源`
                        : `已把 ${added} 个资源加入集合「${name}」`;
                    if (skipped > 0) msg += `；${skipped} 个本来就在集合里`;
                    await this.load();
                    window.alert(msg);
                }
            };
        },
        confirmDelete(ids) {
            this.confirm = {
                title: '移入回收站',                text: `确定将 ${ids.length} 个资源移入回收站吗？`,
                warn: '文件不会立即删除，可在回收站中恢复。',
                okText: '移入回收站',
                action: async () => {
                    const { res, body } = await assetApi.batchDelete(ids);
                    if (!res.ok) throw new Error((body && body.message) || '删除失败');
                    await this.load();
                    await this.loadStats();
                }
            };
        },
        confirmDeleteOne() { this.confirmDelete([this.detailId]); },
        batchRestore() {
            const { res, body } = assetApi.batchRestore(this.selectedIds.slice());
            this.finishBatch(res, body, '恢复', () => this.load());
        },
        confirmPurge(ids) {
            this.confirm = {
                title: '永久删除',
                text: `确定永久删除 ${ids.length} 个资源吗？`,
                warn: '所有版本的文件会从磁盘删除，此操作不可恢复。',
                okText: '永久删除',
                action: async () => {
                    const { res, body } = await assetApi.purge(ids);
                    if (!res.ok) throw new Error((body && body.message) || '删除失败');
                    await this.load();
                    await this.loadStats();
                    await this.loadFolders();
                }
            };
        },
        confirmPurgeOne() { this.confirmPurge([this.detailId]); },
        batchDelete() { this.confirmDelete(this.selectedIds.slice()); },
        batchPurge() { this.confirmPurge(this.selectedIds.slice()); },

        async doPublish(a) {
            try {
                await assetApi.publish(a.id);
                await this.load();
                await this.loadStats();
                if (this.detailId === a.id) await this.loadDetail();
                window.alert(`已发布「${a.name}」的当前版本`);
            } catch (e) {
                window.alert(e.message || '发布失败');
            }
        },

        // ── 弹窗 ──
        startRename(a) {
            this.prompt = {
                kind: 'text',
                title: '重命名资源',
                value: a.name,
                okText: '保存',
                onSubmit: async (name) => {
                    const { res, body } = await assetApi.rename(a.id, name);
                    if (!res.ok) throw new Error((body && body.message) || '重命名失败');
                    await this.load();
                    if (this.detailId === a.id) await this.loadDetail();
                }
            };
        },
        startMove(a) {
            this.prompt = {
                kind: 'folder',
                title: '移动资源',
                value: a.folderId,
                okText: '移动',
                onSubmit: async (folderId) => {
                    const { res, body } = await assetApi.moveOne(a.id, folderId);
                    if (!res.ok) throw new Error((body && body.message) || '移动失败');
                    await this.load();
                    await this.loadFolders();
                    if (this.detailId === a.id) await this.loadDetail();
                }
            };
        },
        async submitPrompt() {
            if (!this.prompt) return;
            this.promptError = '';
            try {
                await this.prompt.onSubmit(this.prompt.value);
                this.prompt = null;
            } catch (e) {
                // 错误要显示出来，不能静默失败
                this.promptError = e.message || '操作失败';
            }
        },
        async runConfirm() {
            if (!this.confirm) return;
            try {
                await this.confirm.action();
                this.confirm = null;
                this.clearSelection();
            } catch (e) {
                window.alert(e.message || '操作失败');
            }
        },
        finishBatch(res, body, verb, after) {
            if (!res || !res.ok) {
                window.alert((body && body.message) || `${verb}失败`);
                return;
            }
            this.clearSelection();
            after();
        }
    },
    // 拖拽上传的全局监听必须在 mounted 后绑定、unmount 时解绑
    // （写在 created 里的话元素还没挂上）
    watch: {
        dragging(v) {
            if (v) {
                window.addEventListener('dragleave', this.onWindowDragLeave);
                window.addEventListener('drop', this.onWindowDrop);
            } else {
                window.removeEventListener('dragleave', this.onWindowDragLeave);
                window.removeEventListener('drop', this.onWindowDrop);
            }
        }
    }
};
</script>

<style scoped>
.am-page { padding: 26px 28px 22px; }
.am-head-actions { display: flex; align-items: center; gap: 8px; }
.am-hidden-file { display: none; }
.am-error { margin-bottom: 10px; }
.am-io-msg { margin-bottom: 10px; }
/* 导入 / 导出 / 存储路径 —— 三个图标按钮成组 */
.am-io-group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
}
.am-io-btn { border: none; background: transparent; }
.am-io-btn:hover:not(:disabled) { background: var(--hover-background); }

.am-body { gap: 12px; }

/* ── 左侧导航 ── */
.am-side {
    flex: none;
    width: 210px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-right: 10px;
    border-right: 1px solid var(--panel-border);
}
.am-nav { display: flex; flex-direction: column; gap: 1px; flex: none; }
.am-nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 32px;
    padding: 0 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-nav-item:hover { background: var(--hover-background); color: var(--text-primary); }
.am-nav-item.is-on {
    background: var(--selected-background);
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
}
.am-nav-icon { display: grid; place-items: center; flex: none; color: var(--text-tertiary); }
.am-nav-item.is-on .am-nav-icon { color: var(--accent); }
.am-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-nav-count {
    flex: none;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
}

.am-side-sep { height: 1px; background: var(--panel-border); margin: 10px 0; }
.am-side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    margin-bottom: 6px;
    padding-left: 9px;
}
.am-side-title {
    margin: 0;
    font-size: var(--text-tag);
    font-weight: var(--weight-semibold);
    color: var(--text-tertiary);
    text-transform: none;
}
.am-tree-wrap { flex: 1; min-height: 0; }
.am-side-add { flex: none; margin-top: 8px; width: 100%; }

/* 表格内的图标按钮 */
.am-vbtn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-vbtn:hover:not(:disabled) { background: var(--hover-background); color: var(--text-primary); }
.am-vbtn:disabled { opacity: 0.35; cursor: not-allowed; }
.am-vbtn-danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }

.am-prompt-select, .am-prompt-input { width: 100%; margin-top: 10px; }
.am-prompt-error { margin-top: 10px; }
</style>