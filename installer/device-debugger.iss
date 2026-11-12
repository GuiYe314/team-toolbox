#ifndef VersionValue
#define VersionValue "0.1.0"
#endif
#ifndef AppSource
#error AppSource must be supplied by the build script
#endif
#ifndef ReleaseOutput
#error ReleaseOutput must be supplied by the build script
#endif
[Setup]
AppId={{DD7438A4-6E96-4CD6-91F8-BC03D4939A12}
AppName=Device Debugger
AppVersion={#VersionValue}
AppPublisher=GuiYe314
AppPublisherURL=https://github.com/GuiYe314/team-toolbox/tree/codex/device-debugger
DefaultDirName={localappdata}\device-debugger
DefaultGroupName=Device Debugger
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#ReleaseOutput}
OutputBaseFilename=device-debugger-Setup-{#VersionValue}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Device Debugger"; Filename: "{app}\启动.cmd"; WorkingDir: "{app}"
Name: "{group}\Stop Device Debugger"; Filename: "{app}\关闭.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\Device Debugger"; Filename: "{app}\启动.cmd"; WorkingDir: "{app}"; Tasks: desktopicon
[Run]
Filename: "{app}\启动.cmd"; Description: "Start Device Debugger"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\backend\src\db.js')) or
     FileExists(ExpandConstant('{app}\data\team-toolbox.sqlite3')) then
    Result := 'This folder contains Team Toolbox. Choose a separate folder for Device Debugger.';
end;
