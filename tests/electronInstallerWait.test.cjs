'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const nsisCache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
const compiler = process.env.T8_TEST_MAKENSIS || path.join(nsisCache, 'nsis-3.0.4.1', 'makensis.exe');
const plugins = path.join(nsisCache, 'nsis-resources-3.4.1', 'plugins', 'x86-unicode');
const includeDir = path.dirname(require.resolve('../node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh'));
const installerFile = require.resolve('../electron/build-resources/installer.nsh');
const installerSource = fs.readFileSync(installerFile, 'utf8');
const hook = installerSource.slice(installerSource.indexOf('!macro customCheckAppRunning'), installerSource.indexOf('!macro customInstall'));

function runProbe(t, { realPlugin = false, code = 603, releaseAt = 0, retry = false }) {
  if (process.platform !== 'win32' || !fs.existsSync(compiler) || (realPlugin && !fs.existsSync(path.join(plugins, 'nsProcess.dll')))) {
    t.skip('Requires cached Windows NSIS compiler/plugin; not installed by this test');
    return null;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-nsis-wait-test-'));
  const q = value => String(value).replace(/\$/g, '$$').replace(/"/g, '$\\"');
  try {
    const executable = path.join(root, 'probe.exe');
    const file = path.join(root, 'probe.nsi');
    // Branch fixtures simulate only the plugin result, elapsed sleeps and button
    // choice; the wait/deny/retry control flow is the actual production macro.
    const simulation = hook.replace('Sleep 1000', 'Sleep 0').replace(
      'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$R3" /SD IDCANCEL IDRETRY t8_retry_app_exit',
      `FileOpen $0 "$EXEDIR\\message.txt" w\nFileWrite $0 "$R3|$t8Calls"\nFileClose $0\n${retry ? 'Goto t8_retry_app_exit' : ''}`,
    );
    const source = `Unicode true
Name "T8 installer wait probe"
OutFile "${q(executable)}"
SilentInstall silent
RequestExecutionLevel user
!include LogicLib.nsh
!define APP_EXECUTABLE_FILENAME "${path.basename(root)}-not-running.exe"
Var t8Calls
${realPlugin ? `!addplugindir "${q(plugins)}"\n!addincludedir "${q(includeDir)}"\n!include "${q(installerFile)}"\n!include allowOnlyOneInstallerInstance.nsh` : `
!define nsProcess::FindProcess \`!insertmacro t8Find\`
!define nsProcess::Unload \`!insertmacro t8Unload\`
!macro t8Find _FILE _ERR
  IntOp $t8Calls $t8Calls + 1
  StrCpy \${_ERR} ${code}
  \${If} ${releaseAt} > 0
  \${AndIf} $t8Calls >= ${releaseAt}
    StrCpy \${_ERR} 603
  \${EndIf}
!macroend
!macro t8Unload
!macroend
${simulation}`}
Section
  StrCpy $t8Calls 0
  StrCpy $R0 "saved0"
  StrCpy $R1 "saved1"
  StrCpy $R3 "saved3"
  !insertmacro ${realPlugin ? 'CHECK_APP_RUNNING' : 'customCheckAppRunning'}
  FileOpen $0 "$EXEDIR\\result.txt" w
  FileWrite $0 "confirmed|$t8Calls|$R0|$R1|$R3"
  FileClose $0
SectionEnd
`;
    fs.writeFileSync(file, '\uFEFF' + source, 'utf8');
    const compiled = spawnSync(compiler, ['/V2', file], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const executed = spawnSync(executable, [], { windowsHide: true, timeout: 10_000 });
    assert.ifError(executed.error);
    const result = fs.existsSync(path.join(root, 'result.txt')) ? fs.readFileSync(path.join(root, 'result.txt'), 'utf8') : null;
    const message = fs.existsSync(path.join(root, 'message.txt')) ? fs.readFileSync(path.join(root, 'message.txt'), 'utf8') : null;
    return { status: executed.status, result, message };
  } finally {
    // Only the fresh owned fixture under the system temporary directory.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('t8-nsis-wait-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('actual NSIS plugin and supported builder hook compile/run with no old app process', t => {
  const r = runProbe(t, { realPlugin: true }); if (!r) return;
  assert.equal(r.status, 0); assert.equal(r.result, 'confirmed|0|saved0|saved1|saved3');
});
test('not-found process passes immediately and preserves registers', t => {
  const r = runProbe(t, {}); if (!r) return;
  assert.equal(r.status, 0); assert.equal(r.result, 'confirmed|1|saved0|saved1|saved3');
  assert.equal(r.message, null);
});
test('still-running process is waited for until normal exit', t => {
  const r = runProbe(t, { code: 0, releaseAt: 3 }); if (!r) return;
  assert.equal(r.status, 0); assert.equal(r.result, 'confirmed|3|saved0|saved1|saved3');
});
test('persistent process blocks installation with bounded polling and cancel exit code', t => {
  const r = runProbe(t, { code: 0 }); if (!r) return;
  assert.equal(r.status, 2); assert.equal(r.result, null);
  assert.match(r.message, /still running or saving/); assert.match(r.message, /\|31$/);
});
test('process detection error fails closed rather than treating error as no app', t => {
  const r = runProbe(t, { code: 608 }); if (!r) return;
  assert.equal(r.status, 2); assert.equal(r.result, null);
  assert.match(r.message, /Process detection failed \(code 608\)/); assert.match(r.message, /\|1$/);
});
test('explicit retry repeats detection and proceeds only after confirmed exit', t => {
  const r = runProbe(t, { code: 0, releaseAt: 32, retry: true }); if (!r) return;
  assert.equal(r.status, 0); assert.equal(r.result, 'confirmed|32|saved0|saved1|saved3');
  assert.match(r.message, /\|31$/);
});
