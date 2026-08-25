import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORKFLOW_DOCTOR_ENABLED_STORAGE_KEY,
  readWorkflowDoctorEnabled,
  writeWorkflowDoctorEnabled,
} from '../src/utils/workflowDoctorPreference.ts';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem(key: string) {
      return key === WORKFLOW_DOCTOR_ENABLED_STORAGE_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key === WORKFLOW_DOCTOR_ENABLED_STORAGE_KEY) value = next;
    },
    removeItem(key: string) {
      if (key === WORKFLOW_DOCTOR_ENABLED_STORAGE_KEY) value = null;
    },
  };
}

const canvas = readFileSync(
  new URL('../src/components/Canvas.tsx', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n');
const styles = readFileSync(
  new URL('../src/styles/index.css', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n');

test('workflow doctor is default-off and persists only an explicit opt-in', () => {
  const storage = memoryStorage();
  assert.equal(readWorkflowDoctorEnabled(storage), false);

  writeWorkflowDoctorEnabled(true, storage);
  assert.equal(readWorkflowDoctorEnabled(storage), true);

  writeWorkflowDoctorEnabled(false, storage);
  assert.equal(readWorkflowDoctorEnabled(storage), false);
});

test('workflow doctor preference fails open for creation when browser storage is unavailable', () => {
  const unavailable = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readWorkflowDoctorEnabled(unavailable), false);
  assert.doesNotThrow(() => writeWorkflowDoctorEnabled(true, unavailable));
});

test('canvas exposes Workflow Doctor as a theme-aware item before placement shelf in the consolidated tools menu', () => {
  const doctorIndex = canvas.indexOf('data-canvas-floating-ui="workflow-doctor-toggle"');
  const shelfIndex = canvas.indexOf('data-canvas-floating-ui="placement-shelf-toggle"');
  assert.notEqual(doctorIndex, -1);
  assert.ok(doctorIndex < shelfIndex);
  assert.match(canvas, /data-canvas-floating-ui="control-tools-menu"/);
  assert.match(canvas, /className=\{workflowDoctorEnabled \? 'is-active' : ''\}/);
  assert.match(canvas, /aria-checked=\{workflowDoctorEnabled\}/);
  assert.match(canvas, /t\('canvas:controls\.doctorOff'\)/);
  assert.match(canvas, /<LucideIcons\.Stethoscope size=\{16\} \/>/);
  assert.match(styles, /\.t8-control-rail-doctor\.is-active/);
  assert.match(styles, /background: var\(--t8-flow-controls-button-hover-bg\) !important/);
});

test('disabled doctor bypasses diagnostics and its global pending lock while keeping stable execution scope checks', () => {
  const start = canvas.indexOf('const authorizeRunNodes = useCallback');
  const end = canvas.indexOf('\n  // ===== 批量运行 =====', start);
  const authorization = canvas.slice(start, end);
  const disabledBranchStart = authorization.indexOf('if (!workflowDoctorEnabled)');
  const pendingGate = authorization.indexOf('if (runPreflightPendingRef.current)');
  const doctorAuthorization = authorization.indexOf('authorizeRunPreflight({');
  assert.ok(disabledBranchStart >= 0);
  assert.ok(disabledBranchStart < pendingGate);
  assert.ok(pendingGate < doctorAuthorization);

  const disabledBranch = authorization.slice(disabledBranchStart, pendingGate);
  assert.match(disabledBranch, /buildDerivedScope\(\)/);
  assert.match(disabledBranch, /isSameRunPreflightExecutionSnapshot/);
  assert.match(disabledBranch, /derivedScope\.coverageComplete/);
  assert.match(disabledBranch, /return derivedScope/);
  assert.doesNotMatch(disabledBranch, /buildRunPreflightDiagnostics|prepareRunAction|authorizeRunPreflight|setRunPreflightModal/);
});

test('turning the doctor off cancels an already-open diagnostic preview', () => {
  assert.match(canvas, /writeWorkflowDoctorEnabled\(next\)/);
  assert.match(canvas, /if \(!next\) \{\s*runPreflightAbortRef\.current\?\.abort\(\);\s*settleRunPreflightDecision\(false\);/);
});
