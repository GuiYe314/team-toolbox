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
#define AppVersion "0.1.0"
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
OutputBaseFilename="team-toolbox-Setup-0.1.0"
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
; 整个应用目录（后端 + 生产依赖 + 前端产物 + 启动脚本 + 空 data 目录）
Source: "..\build\release\0.1.0\team-toolbox\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\启动.cmd"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\启动.cmd"; Tasks: desktopicon

[Run]
Filename: "{app}\启动.cmd"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
// 安装前检查 Node.js —— 后端是 Node 程序，没有 Node 跑不起来。
// 这不是可选依赖，所以必须在安装阶段就告知，而不是等用户双击后才报错。
//
// 三个踩过的坑（都是 Pascal Script 特有的，报错信息完全指不到原因）：
// 1. RegQueryStringValue 是 **4 参数** (RootKey, SubKey, ValueName, Data)，
//    没有第 5 个 Required 参数 —— 传 5 个报 "Invalid number of parameters"。
// 2. SubKey 与 ValueName 必须**分开**：注册表路径 HKLM\SOFTWARE\nodejs 下的
//    值 'Path'，应写成 ('SOFTWARE\nodejs', 'Path')。
//    合成一级 ('SOFTWARE\nodejs\Node.js', 'Path') 也会通过编译，
//    但查不到值 —— 会静默失效，不报错。
// 3. 不支持动态数组 array[0..4] of String，也不支持逗号分隔的多变量声明
//    （C0, C1: String;），两者都报 "Variable expected"。逐个声明即可。
//
// 另外只查注册表不够 —— 用 nvm-windows / fnm / Volta 等版本管理器安装的
// Node 不写 HKLM\SOFTWARE\nodejs，因此还要查常见安装位置。
function NodeInstalled: Boolean;
var
  NodePath: String;
  C0: String;
  C1: String;
  C2: String;
  C3: String;
  C4: String;
begin
  // 1) 标准安装（写入注册表）
  NodePath := '';
  RegQueryStringValue(HKLM, 'SOFTWARE\nodejs', 'Path', NodePath);
  if (NodePath <> '') and FileExists(NodePath + '\node.exe') then
  begin
    Result := True;
    exit;
  end;

  // 2) 常见安装位置（含版本管理器）
  C0 := GetEnv('ProgramFiles') + '\nodejs\node.exe';
  C1 := GetEnv('LOCALAPPDATA') + '\Programs\nodejs\node.exe';
  C2 := GetEnv('APPDATA') + '\nvm\node.exe';
  C3 := GetEnv('LOCALAPPDATA') + '\Volta\bin\node.exe';
  C4 := GetEnv('USERPROFILE') + '\scoop\apps\nodejs\current\node.exe';

  if ((C0 <> '') and FileExists(C0)) or
     ((C1 <> '') and FileExists(C1)) or
     ((C2 <> '') and FileExists(C2)) or
     ((C3 <> '') and FileExists(C3)) or
     ((C4 <> '') and FileExists(C4)) then
  begin
    Result := True;
    exit;
  end;

  Result := False;
end;

function InitializeSetup(): Boolean;
begin
  if not NodeInstalled() then
  begin
    if MsgBox('未检测到 Node.js。' + #13#10 + #13#10 +
               'team-toolbox 的后端依赖 Node.js 运行时（v20.19+ 或 v22 LTS）。' + #13#10 +
               '请先安装后再继续：https://nodejs.org/en/download' + #13#10 + #13#10 +
               '仍然继续安装？',
               mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
      exit;
    end;
  end;
  Result := True;
end;
