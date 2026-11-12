<template>
    <button ref="trigger" id="adb-help" class="btn btn-sm" type="button" aria-haspopup="dialog" :aria-expanded="show" @click="open">帮助</button>
    <Teleport to="body">
        <div v-if="show" class="overlay" @click.self="close" @keydown="onKeydown">
            <section ref="dialog" class="dialog adb-help-dialog" role="dialog" aria-modal="true" aria-labelledby="adb-help-title">
                <div class="adb-help-head">
                    <h2 id="adb-help-title" class="dialog-title">安卓调试帮助</h2>
                    <button ref="closeButton" id="adb-help-close" class="btn btn-sm" type="button" @click="close">关闭</button>
                </div>
                <div class="adb-help-body">
                    <h3>连接前准备</h3>
                    <ol>
                        <li>在运行工具箱的电脑解压 Android SDK Platform-Tools，点击上方“ADB 设置”打开弹窗，输入文件夹搜索 adb.exe；多个版本可选择。</li>
                        <li>手机与电脑连接同一局域网，在 Android 11 及以上手机的开发者选项打开“无线调试”。</li>
                        <li>使用启动器显示的局域网地址打开工具箱；服务器本机也可使用 localhost。ADB、设备搜索和命令都在运行工具箱的电脑执行。</li>
                    </ol>
                    <h3>扫码配对并连接</h3>
                    <p>点击“生成配对二维码”，手机进入“开发者选项 → 无线调试 → 使用二维码配对设备”扫描。请使用这个专用扫码入口，保持页面打开，等待自动配对、连接和刷新设备。</p>
                    <p>二维码两分钟有效，可取消或重新生成。离开页面会取消会话；取消不会删除手机已经保存的配对记录。</p>
                    <h3>六位码配对与手动连接</h3>
                    <p>手机选择“使用配对码配对设备”，保持该页面打开。点击“搜索无线设备”，核对配对地址后填写六位码；配对成功后连接“连接服务”，或输入无线调试主页的 IP 与连接端口。</p>
                    <p>配对端口与连接端口不同。配对码提交后清空。断开时需核对设备序列号，只会断开所选无线设备。</p>
                    <h3>常用 ADB 命令</h3>
                    <p>内置六项：锁定程序、解锁程序（恢复桌面）、获取 IP、设备信息、手机内存使用、CPU 使用。刷新设备并选择目标后，选择命令，点击“执行”查看结果；内存与 CPU 返回系统查询快照，需要时再次执行刷新。</p>
                    <p>锁定或解锁时会读取当前 Android 用户、HOME 应用和默认桌面。按包名或组件搜索，主动选择程序或要恢复的桌面，点击“执行”，核对设备、用户和组件后“确认设置”。手机确认成功并复查默认值后，按手机主页键进入所选程序。</p>
                    <p>锁定程序使用 set-home-activity 设置默认桌面，仅能选择手机提供的 HOME 应用；普通应用需要先声明 HOME 入口，此设置不提供系统级禁退锁定。用户切换或应用失效时需“重新读取应用”后选择；解锁时选择原桌面即可恢复。</p>
                    <h3>添加自己的常用命令</h3>
                    <p>点击命令区的“添加命令”，填写名称、分类、命令参数及可选说明，点击“保存命令”。例如查看某个应用内存可填写 shell dumpsys meminfo com.example.app；不用填写 adb 或 -s 设备参数。含空格的参数使用引号包裹。保存后按分类出现在命令列表，支持“编辑”和确认后“删除”；内置命令保持只读。</p>
                    <p>选择目标设备和自定义命令后点击“执行”，核对完整命令与设备，再“确认执行”。保存和选择不会执行命令。参数支持 shell、reboot、get-state、get-serialno、get-devpath、features 和 logcat；不支持多条拼接、管道或重定向。读取日志快照时可使用 logcat -d，持续采集请使用“设备日志”。</p>
                    <p>最多保存 100 条自定义命令，重启后保留；配置只在运行服务器的电脑保存，不随团队内容备份。命令在其他页面更新后，需要点击“重新读取命令”再核对。执行有超时和输出限制，结果只保留在当前页面。</p>
                    <h3>查看 APK 包名</h3>
                    <p>查看安装包包名：在“查看 APK 包名”选择电脑上的 APK，点击“读取包名”，读取完成后可“复制包名”。不需要手机、ADB 或 Android SDK，最多 1 GiB；上传结束后读取根清单，文件仅临时保存并在结束或取消后清理。读取包名不校验签名或保证可安装；损坏清单或资源引用会明确报错。</p>
                    <h3>传送 APK 并安装</h3>
                    <p>在右侧“APK 传送安装”选择已连接并授权的设备，再选择电脑上的 .apk 文件，点击“传送并安装”。核对文件名、大小和目标设备后点击“确认安装”；无线、USB 和模拟器都使用当前设备列表。</p>
                    <p>上传百分比只表示电脑浏览器向工具箱传送文件；随后会显示 ADB 传送及安装等待状态，直到手机返回成功。默认覆盖同包名应用并保留应用数据，不自动打开应用；手机若弹出安装确认，需要在手机完成确认。</p>
                    <p>支持单个完整 APK，最多 1 GiB；AAB、APKS 和分包集合不能直接安装。文件只临时保存，操作结束后清理，不加入团队备份。上传和 ADB 安装各有五分钟时限，可“取消操作”；离开页面也会取消，但不能撤销手机已经完成的安装，请核对手机最终状态。</p>
                    <p>安装失败会保留所选文件并显示原因，可重新传送。同包名签名不一致、版本过低、空间不足或系统限制时，需要重新提供兼容的 APK 或检查手机设置；工具不会自动卸载应用或清除数据。</p>
                    <h3>同一 APK 安装到多台手机</h3>
                    <p>勾选“多设备安装”，逐台选择在线设备，或点击“全选在线设备”，每批最多 20 台。选择一个 APK 后点击“安装到 N 台设备”，逐项核对确认列表，再点击“确认安装”。安装包只向工具箱上传一次，随后按设备顺序逐台安装，显示等待、安装中、成功与失败状态。</p>
                    <p>单台安装失败、掉线或超过五分钟会继续下一台。完成后可点击“只选择失败设备”，重新核对在线目标并确认重试，已成功设备不会自动重装。取消操作或离开页面会停止当前及后续队列，已完成安装不回滚；结果未确认时请在手机核对最终状态。</p>
                    <h3>一次安装多个 APK</h3>
                    <p>选择文件时可按住 Ctrl 多选，最多 20 个，单个 1 GiB、合计 4 GiB；列表可移除文件。选择一台手机即可依次安装多个 APK，勾选“多设备安装”可对多台手机执行。确认区会列出全部文件与目标，全部上传并校验后才开始安装。</p>
                    <p>多文件队列最多两台手机并行，每台按文件选择顺序安装。逐“手机 + APK”显示结果，单项失败继续后续任务；“只选择失败安装项”只重试明确失败且在线的组合，重新确认时可核对精确列表。不会把另一台手机已经成功的 APK 重新安装。</p>
                    <p>上传整批最多五分钟，每项安装五分钟，安装队列总计一小时。取消、连接断开、进入后台或离页会停止活动与后续任务，已完成安装不回滚；未确认结果请在手机核对。</p>
                    <h3>Unity persistentDataPath 文件</h3>
                    <p>在“Unity 替换 persistentDataPath 中文件”选择在线设备，点击“读取应用”，按包名选择 Unity App，再“读取 persistentDataPath”。目录按当前 Android 用户定位到 Android/data/包名/files，App 至少运行一次才会创建；列表不能自动识别 Unity 应用，自定义存储位置不在此功能范围内。</p>
                    <p>点击目录进入或返回上级，普通文件可预览 UTF-8 文本或下载。添加时选择电脑文件并核对手机端文件名；替换时先在列表点击“替换”，选择新文件，点击“核对并替换”，确认设备、包名、路径和大小后提交。替换前建议关闭 App 并下载原文件备份，运行中的 App 仍可能写入文件。</p>
                    <p>单文件上传/下载最多 256 MiB，文本预览最多 256 KiB，单目录最多 1000 项。替换前复查原文件 SHA256，传送完成后校验临时文件再提交。取消或断连不能撤销已提交的写入，请刷新核对；手机限制访问时明确报错，不自动 root、改权限或访问内部私有目录。</p>
                    <h3>实时设备日志</h3>
                    <p>左侧集中设备连接与列表，右侧提供命令、APK、屏幕和日志，可分别滚动。在“设备日志”选择在线设备，点击“开始采集”，读取最近约 100 条 Logcat 后持续接收新日志。可按最低级别、关键词筛选，选择自动滚动，或清空显示；清空不会删除手机日志。</p>
                    <p>点击“停止采集”结束进程并保留当前结果。切换日志设备、离开页面、修改 ADB 配置或目标设备断开时会停止采集。页面长时间未响应也会自动停止，重新开始即可。日志只在内存中，服务端最多缓存 2000 条或 1 MiB，旧日志自动轮换。</p>
                    <h3>查看某个 App 的运行情况</h3>
                    <p>选择日志设备，把“日志范围”改为“指定应用”，按包名搜索并选择应用。界面显示运行中或未运行、进程号和最后检查时间；“运行中”表示进程存在，不代表应用在前台，可点击“刷新状态”重新检查。</p>
                    <p>点击“开始采集”后，仅显示匹配的应用主进程及“包名:子进程”的日志。采集期间约每两秒更新进程号，应用未运行时等待，重新打开后跟随新进程；切换应用会停止旧采集并清空显示。</p>
                    <p>应用没有输出日志时可能为空。持续时间短于检查间隔的进程、自定义为其他名称的进程，以及由系统进程输出的记录可能无法捕获；需要排查这些情况时切回“设备全部日志”。</p>
                    <h3>网页查看手机屏幕</h3>
                    <p>在“手机屏幕”选择在线设备，点击“刷新画面”读取一次，或选择 1、2、5 秒间隔后点击“开始连续刷新”。每轮读取完成后才等待所选间隔，实际速度取决于手机和网络。“停止读取”保留最后画面；“清空画面”会停止并移除图片。“放大查看”打开弹窗，可按 Escape 关闭。</p>
                    <p>切换设备、离开页面或修改配置会停止读取并清空旧画面；页面进入后台会停止连续刷新。图片仅在内存中，不自动保存。受保护应用可能显示黑屏；操作手机后可刷新查看结果。</p>
                    <h3>常见问题</h3>
                    <ul>
                        <li>找不到 ADB：确认已解压 Platform-Tools，在设置中选择更靠近 adb.exe 的文件夹；扫描最多向下六层并有数量和时间限制。</li>
                        <li>扫码一直等待或找不到服务：确认同一局域网，路由器未隔离设备或屏蔽 mDNS，手机使用无线调试的专用扫码入口。</li>
                        <li>已配对但未连接：核对无线调试主页的当前连接端口；手机重启或切换网络后，端口可能变化。</li>
                        <li>设备未授权或离线：在手机确认授权，检查无线调试和网络，再刷新设备。</li>
                        <li>命令失败：查看结果中的具体原因；系统版本或厂商可能限制部分命令，失败后可重新选择或重试。</li>
                        <li>日志为空或中断：确认所选设备在线，检查级别和关键词筛选；设备掉线、日志进程退出或页面长时间未响应后，需要重新开始采集。</li>
                    </ul>
                </div>
            </section>
        </div>
    </Teleport>
</template>

<script>
export default {
    name: 'AndroidHelp',
    data() { return { show: false }; },
    methods: {
        async open() { this.show = true; await this.$nextTick(); this.$refs.closeButton?.focus(); },
        close() { this.show = false; this.$refs.trigger?.focus(); },
        onKeydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
            if (event.key === 'Tab') {
                const buttons = [...this.$refs.dialog.querySelectorAll('button, a[href], input, select, [tabindex="0"]')];
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        }
    }
};
</script>

<style scoped>
.adb-help-dialog { width: min(var(--adb-help-width), calc(100vw - var(--page-padding) * 2)); max-width: none; max-height: calc(100vh - var(--page-padding) * 2); display: flex; flex-direction: column; box-sizing: border-box; }
.adb-help-head { display: flex; justify-content: space-between; align-items: center; gap: var(--gap-column); }
.adb-help-head h2 { margin: 0; }
.adb-help-body { min-height: 0; overflow-y: auto; margin-top: var(--gap-column); line-height: var(--line-relaxed); color: var(--text-secondary); }
.adb-help-body h3 { color: var(--text-primary); font-size: var(--text-section-title); margin: var(--gap-column) 0; }
.adb-help-body ul, .adb-help-body ol { padding-left: var(--page-padding); }
.adb-help-body li + li { margin-top: var(--adb-small-gap); }
</style>
