; ============================================================================
;  team-toolbox 安装包定义（Inno Setup）
;
;  由 scripts/build_release.ps1 编译。该脚本会注入版本号、源目录与输出名，
;  因此这里的占位值只在手工编译时生效。
;
;  安装身份：
;    安装目录 %LOCALAPPDATA%\team-toolbox
;    数据目录 <安装目录>\data（SQLite + 资源文件）
;    端口 3000（后端同时托管前端与 API，同源）
;
;  与参考项目 TravelMap 一致：安装身份与数据目录固定，卸载保留数据。
; ============================================================================
#define AppName "team-toolbox"
#define AppPublisher "GuiYe314"
#define AppVersion "0.1.1"
#define AppExeName "team-toolbox"

[Setup]
AppId={{7C3E9A21-4D8B-4F62-A1E5-9C3B7D2E5F84}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\team-toolbox
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename="team-toolbox-Setup-0.1.1"
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 32 位系统也允许安装（Node 运行时自带在包里）
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\backend\node_modules\.bin\*.*
; 卸载时保留用户数据（文档与资源）——与 TravelMap 相同的取舍
; 如需彻底清理，用户手动删除安装目录即可。

[Languages]
Name: "chinese"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked

[Files]
; 整个应用目录（后端 + 生产依赖 + 前端产物 + 内置 Node 运行时 + 启动脚本 + 空 data 目录）
Source: "..\build\release\0.1.1\team-toolbox\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\启动.cmd"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\启动.cmd"; Tasks: desktopicon

[Run]
Filename: "{app}\启动.cmd"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
// 此前这里有一段「未装 Node.js 就警告」的检查。
// v0.1.1 起**不再需要**：发布包已内置 Node 运行时（runtime\node.exe），
// 用户机器上有没有 Node、是什么版本，都不影响启动。
//
// 取消这个检查的另一个理由：它挡不住真正的问题 —— 系统 Node 的
// NODE_MODULE_VERSION 与随包分发的 better-sqlite3 原生二进制不匹配时，
// 装完照样启动失败（v0.1.0 就是这样坏的：装的时候提示了 Node 存在，
// 跑起来却报 ABI 不兼容）。内置运行时才是根治。
//
// 保留 [Code] 段（空）以维持 Inno Setup 的结构完整 —— 后续若需要
// 安装期校验（如端口占用检查），可直接在此追加。
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
