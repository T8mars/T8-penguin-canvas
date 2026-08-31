import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  formatCreatorModelLabel,
  formatCreatorProviderLabel,
  subscribeCreatorEventsV2,
  type CreatorCatalogItemV2,
} from '../src/services/creatorAgentV2';

const root = path.resolve(import.meta.dirname, '..');
const panelSource = readFileSync(path.join(root, 'src/components/CreatorAgentPanelV2.tsx'), 'utf8');
const entrySource = readFileSync(path.join(root, 'src/components/CreatorAgentEntry.tsx'), 'utf8');
const serviceSource = readFileSync(path.join(root, 'src/services/creatorAgentV2.ts'), 'utf8');
const styles = readFileSync(path.join(root, 'src/styles/index.css'), 'utf8');

function catalogItem(input: Partial<CreatorCatalogItemV2>): CreatorCatalogItemV2 {
  return {
    providerId: 'custom-provider',
    providerLabel: 'Custom Provider',
    modelId: 'unknown-model',
    label: '',
    configured: true,
    recommended: false,
    ...input,
  };
}

test('Creator model labels prefer catalog names and never rewrite unknown ids', () => {
  assert.equal(formatCreatorModelLabel(catalogItem({
    modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
    label: 'Omni 1.1 Flash',
  })), 'Custom Provider · Omni 1.1 Flash');
  assert.equal(formatCreatorModelLabel(catalogItem({
    modelId: 'mystery-lowprice_x',
    label: '',
  })), 'Custom Provider · mystery-lowprice_x');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerLabel: 'Custom Provider',
    label: 'Custom Provider · Studio Model',
  })), 'Custom Provider · Studio Model');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerId: 'seedance-nz',
    providerLabel: 'Zhenzhen Budget AI House',
    label: 'Official catalog label',
  })), 'Official catalog label');
  assert.equal(formatCreatorProviderLabel('seedance-nz', '贞贞的平价AI小屋', false), 'Zhenzhen Budget AI House');
  assert.equal(formatCreatorProviderLabel('zhenzhen', '贞贞的AI工坊', false), 'Zhenzhen AI Studio');
  assert.equal(formatCreatorModelLabel(catalogItem({
    providerId: 'seedance-nz',
    providerLabel: '贞贞的平价AI小屋',
    modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
    label: 'zhenzhen-video-g-omni-1.1-flash-lowprice（平价 Omni 1.1）',
  }), false), 'zhenzhen-video-g-omni-1.1-flash-lowprice');
});

test('Creator panel uses one operation state and exposes progress to assistive technology', () => {
  assert.match(panelSource, /useState<CreatorOperation>\('idle'\)/);
  assert.doesNotMatch(panelSource, /const \[(?:busy|uploading|settingsBusy),\s*set/);
  assert.match(panelSource, /role="dialog"/);
  assert.match(panelSource, /aria-labelledby=\{panelTitleId\}/);
  assert.match(panelSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(panelSource, /role="log"[\s\S]*aria-live="polite"[\s\S]*aria-busy=/);
  assert.match(panelSource, /aria-current=\{index === currentIndex \? 'step'/);
});

test('Creator lazy fallback remains visible and themed without a portal host', () => {
  assert.match(entrySource, /fallback=\{launcherHost \? createPortal\(fallback, launcherHost\) : fallback\}/);
  assert.match(entrySource, /data-theme-visual=\{props\.visualStyle\}/);
  assert.match(entrySource, /data-theme-mode=\{props\.themeMode\}/);
  assert.match(entrySource, /style=\{launcherStyle\}/);
  assert.match(entrySource, /key=\{`\$\{props\.projectId\}:\$\{props\.canvasId\}`\}/);
  assert.match(entrySource, /const \[panelOpen, setPanelOpen\] = useState\(false\)/);
  assert.match(entrySource, /initialOpen=\{panelOpen\}/);
  assert.match(entrySource, /onOpenChange=\{setPanelOpen\}/);
});

test('Creator keeps reconnect, draft, upload, and localized failure paths bounded', () => {
  assert.match(serviceSource, /onCursor\?: \(sequence: number\) => void/);
  assert.match(serviceSource, /handlers\.onCursor\?\.\(sequence\)/);
  assert.match(panelSource, /onCursor: \(sequence\) =>/);
  assert.match(panelSource, /window\.setTimeout\([\s\S]*?250\)/);
  assert.match(panelSource, /Commit each successful upload immediately/);
  assert.match(panelSource, /if \(overrideAttachments\) setAttachments\(overrideAttachments\)/);
  assert.match(panelSource, /message\.errorCode === 'CREATOR_LLM_INTERRUPTED'/);
  assert.match(panelSource, /const selectHistoryConversation = useCallback\(async/);
  assert.doesNotMatch(panelSource, /void loadConversation\(item\.id\);/);
  assert.match(panelSource, /\{attachments\.map\(\(item\) =>/);
  assert.match(panelSource, /useState\(''\).*activeResponseId|activeResponseId, setActiveResponseId/s);
  assert.match(panelSource, /const pending = sendCreatorMessageV2\(/);
  assert.match(panelSource, /message\.responseId === activeResponseRef\.current[\s\S]*message\.status === 'streaming'/);
  assert.doesNotMatch(panelSource, /setActiveResponseId\(responseId\);\s*const snapshot = await pending/);
  assert.match(panelSource, /const restoreFailedTurn = useCallback/);
  assert.match(panelSource, /assistant\.replyToMessageId[\s\S]*item\.id === assistant\.replyToMessageId/);
  assert.match(panelSource, /setAttachments\(user\.media\.slice\(0, 12\)\)/);
  assert.match(panelSource, /setBoundSelectionIds\(user\.selectedNodes\.map\(\(node\) => node\.nodeId\)\.slice\(0, 24\)\)/);
  assert.match(panelSource, /operation === 'reply' && activeResponseId/);
  assert.match(panelSource, /toLocaleDateString\(isChinese \? 'zh-CN' : 'en-US'\)/);
  assert.doesNotMatch(panelSource, /if \(catalog\) \{\s*setSettingsDraft\(preferences\);\s*return;/);
  assert.match(panelSource, /attachmentKind\(file, result\.mime\)/);
  assert.match(panelSource, /disabled=\{isOperating\} onClick=\{\(\) => setBoundSelectionIds\(\[\]\)\}/);
  assert.match(panelSource, /setHistoryOpen\(false\);\s*dismissSettings\(\);/);
});

test('Creator EventSource advances the durable cursor from the event envelope', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  const instances: FakeEventSource[] = [];
  class FakeEventSource {
    static readonly CLOSED = 2;
    readonly url: string;
    closed = false;
    onerror: ((event: Event) => unknown) | null = null;
    private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

    constructor(url: string | URL) {
      this.url = String(url);
      instances.push(this);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const callback = listener as unknown as (event: MessageEvent<string>) => void;
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }

    emit(type: string, data: unknown, lastEventId: string) {
      const event = { data: JSON.stringify(data), lastEventId } as MessageEvent<string>;
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }

    close() { this.closed = true; }
  }

  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
  try {
    const cursors: number[] = [];
    const messageIds: string[] = [];
    const unsubscribe = subscribeCreatorEventsV2('creator-session', 'project-local', 'canvas-local', 3, {
      onCursor: (sequence) => cursors.push(sequence),
      onMessage: (message) => messageIds.push(message.id),
      onAction: () => {},
    });
    assert.equal(instances.length, 1);
    assert.match(instances[0].url, /after=3/u);
    instances[0].emit('message', { sequence: 9, data: { id: 'message-9' } }, '9');
    assert.deepEqual(cursors, [9]);
    assert.deepEqual(messageIds, ['message-9']);
    unsubscribe();
    assert.equal(instances[0].closed, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'EventSource', original);
    else delete (globalThis as { EventSource?: unknown }).EventSource;
  }
});

test('Creator CSS includes touch, 200% reflow, and reduced-motion gates', () => {
  assert.match(styles, /@media \(pointer: coarse\), \(max-width: 520px\)/);
  assert.match(styles, /\.t8-creator-v2-header button,[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  assert.match(styles, /@media \(max-width: 900px\), \(max-height: 620px\)/);
  assert.match(styles, /max-height: calc\(100dvh - 90px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important;/);
});
