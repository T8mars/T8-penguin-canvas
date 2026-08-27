import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  Trash2,
  Download,
  Upload,
  Sparkles,
  HelpCircle,
  X,
  Play,
  Square,
  Magnet,
  Bell,
  BellOff,
  Archive,
  PackageOpen,
  Search,
  History,
  Terminal as TerminalIcon,
  LayoutGrid,
  MousePointer2,
  RotateCcw,
  GripVertical,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
  Grid3x3,
  ScanLine,
  Clapperboard,
} from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import { useLogStore } from '../stores/logs';
import { useTaskCompletionSoundStore } from '../stores/taskCompletionSound';
import { useShortcutStore } from '../stores/shortcuts';
import { useRadialMenuStore } from '../stores/radialMenu';
import { CANVAS_TEMPLATES, type CanvasTemplate } from '../config/canvasTemplates';
import { NODE_REGISTRY } from '../config/nodeRegistry';
import {
  DEFAULT_SHORTCUTS,
  formatShortcutCombo,
  formatShortcutList,
  keyboardEventToShortcutCombo,
  validateShortcutCombo,
  type ShortcutAction,
  type ShortcutCombo,
} from '../utils/keyboardShortcuts';
import {
  RADIAL_NODE_COLOR_HEX,
  normalizeRadialMenuSlots,
  visibleRadialMenuNodeOptions,
} from '../utils/radialMenu';
import type { NodeAlignAction } from '../utils/nodeAlign';
import type { NodeType } from '../types/canvas';

interface CanvasToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  clipboardCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: () => void;
  onApplyTemplate: (tpl: CanvasTemplate) => void;
  onFindNodeById: () => void;
  // 批量运行
  onRunAll: () => void;
  onCancelRun: () => void;
  isRunning: boolean;
  batchTotal: number;
  batchDone: number;
  // 吸附开关
  snapEnabled: boolean;
  onToggleSnap: () => void;
  outputMaterialPersistenceEnabled: boolean;
  onToggleOutputMaterialPersistence: () => void;
  historyCount: number;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onOpenVibeXWorkbench: () => void;
  onCreateVibeXNode: () => void;
  onCreateGenerationTarget: () => void;
  onExportResourcePackage: () => void;
  onAlignSelection: (action: NodeAlignAction) => void;
  children?: ReactNode;
  endControl?: ReactNode;
}

export default function CanvasToolbar({
  canUndo,
  canRedo,
  selectedCount,
  clipboardCount,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDelete,
  onExport,
  onImport,
  onApplyTemplate,
  onFindNodeById,
  onRunAll,
  onCancelRun,
  isRunning,
  batchTotal,
  batchDone,
  snapEnabled,
  onToggleSnap,
  outputMaterialPersistenceEnabled,
  onToggleOutputMaterialPersistence,
  historyCount,
  historyOpen,
  onToggleHistory,
  onOpenVibeXWorkbench,
  onCreateVibeXNode,
  onCreateGenerationTarget,
  onExportResourcePackage,
  onAlignSelection,
  children,
  endControl,
}: CanvasToolbarProps) {
  const { t } = useTranslation('canvas');
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const termOpen = useLogStore((s) => s.open);
  const termUnread = useLogStore((s) => s.unread);
  const toggleTerm = useLogStore((s) => s.toggleOpen);
  const completionSoundEnabled = useTaskCompletionSoundStore((s) => s.enabled);
  const toggleCompletionSound = useTaskCompletionSoundStore((s) => s.toggleEnabled);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const setActionShortcuts = useShortcutStore((s) => s.setActionShortcuts);
  const clearActionShortcuts = useShortcutStore((s) => s.clearActionShortcuts);
  const resetShortcutAction = useShortcutStore((s) => s.resetAction);
  const resetAllShortcuts = useShortcutStore((s) => s.resetAll);
  const radialSlotsRaw = useRadialMenuStore((s) => s.slots);
  const radialLongPressMs = useRadialMenuStore((s) => s.longPressMs);
  const setRadialSlotNodeType = useRadialMenuStore((s) => s.setSlotNodeType);
  const setRadialSlotEnabled = useRadialMenuStore((s) => s.setSlotEnabled);
  const moveRadialSlot = useRadialMenuStore((s) => s.moveSlot);
  const setRadialLongPressMs = useRadialMenuStore((s) => s.setLongPressMs);
  const resetRadialMenu = useRadialMenuStore((s) => s.resetRadialMenu);
  const [tplOpen, setTplOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);
  const [shortcutMessage, setShortcutMessage] = useState<string>('');
  const [draggingRadialSlot, setDraggingRadialSlot] = useState<number | null>(null);
  const tplRef = useRef<HTMLDivElement>(null);
  const alignRef = useRef<HTMLDivElement>(null);
  const radialNodeOptions = useMemo(() => visibleRadialMenuNodeOptions(NODE_REGISTRY), []);
  const radialSlots = useMemo(
    () => normalizeRadialMenuSlots(NODE_REGISTRY, radialSlotsRaw),
    [radialSlotsRaw],
  );
  const radialNodesByType = useMemo(
    () => new Map(radialNodeOptions.map((node) => [node.type, node])),
    [radialNodeOptions],
  );
  const groupedShortcutActions = useMemo(() => {
    const groups = new Map<string, ShortcutAction[]>();
    for (const action of DEFAULT_SHORTCUTS) {
      groups.set(action.group, [...(groups.get(action.group) || []), action]);
    }
    return Array.from(groups.entries());
  }, []);

  const shortcutText = (actionId: string) => formatShortcutList(shortcuts[actionId]);

  // 点击外部关闭模板下拉
  useEffect(() => {
    if (!tplOpen) return;
    const onClick = (e: MouseEvent) => {
      if (tplRef.current && !tplRef.current.contains(e.target as Node)) {
        setTplOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [tplOpen]);

  useEffect(() => {
    if (!alignOpen) return;
    const onClick = (e: MouseEvent) => {
      if (alignRef.current && !alignRef.current.contains(e.target as Node)) {
        setAlignOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [alignOpen]);

  useEffect(() => {
    if (selectedCount === 0) setAlignOpen(false);
  }, [selectedCount]);

  useEffect(() => {
    if (!recordingActionId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        setRecordingActionId(null);
        setShortcutMessage('');
        return;
      }
      const combo = keyboardEventToShortcutCombo(event);
      const validation = validateShortcutCombo(combo);
      if (!validation.ok || !combo) {
        const reason = validation.reason === 'reserved'
          ? '这个快捷键会和浏览器或系统冲突，换一个吧。'
          : '请按一个包含普通按键的快捷键。';
        setShortcutMessage(reason);
        return;
      }
      const result = setActionShortcuts(recordingActionId, [combo]);
      if (!result.ok) {
        const conflictText = result.conflicts?.map((item) => item.label).join('、') || '其他动作';
        setShortcutMessage(`快捷键已被「${conflictText}」占用。`);
        return;
      }
      setRecordingActionId(null);
      setShortcutMessage(`已设置为 ${formatShortcutCombo(combo)}。`);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recordingActionId, setActionShortcuts]);

  const baseBtn = isPixel
    ? 't8-toolbar-button relative flex items-center justify-center w-8 h-8 rounded-full transition-colors hover:bg-[var(--px-muted)] text-[var(--px-ink)]'
    : `t8-toolbar-button relative flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
        isDark ? 'text-zinc-200 hover:bg-white/10' : 'text-zinc-700 hover:bg-black/5'
      }`;
  const disabledCls = 'opacity-30 cursor-not-allowed pointer-events-none';
  const sep = isPixel
    ? 'w-px self-stretch mx-1 bg-[var(--px-ink)]/30'
    : `w-px self-stretch mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`;

  const containerCls = isPixel
    ? 't8-toolbar-panel flex items-center gap-0.5 px-2 py-1 px-card'
    : `t8-toolbar-panel flex items-center gap-0.5 px-1.5 py-1 rounded-lg backdrop-blur shadow-lg border ${
        isDark ? 'bg-zinc-900/90 border-white/10' : 'bg-white/95 border-black/10'
      }`;

  const kbdCls = isPixel
    ? 'bg-[var(--px-surface)] border-2 border-[var(--px-ink)] text-[var(--px-ink)]'
    : isDark
      ? 'bg-white/10 text-white'
      : 'bg-white border border-black/10 text-zinc-900';
  const compactBtnCls = isPixel
    ? 'px-btn px-btn--ghost text-[10px] px-2 py-1'
    : `rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        isDark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-black/5 text-zinc-700 hover:bg-black/10'
      }`;
  const dangerBtnCls = isPixel
    ? 'px-btn px-btn--ghost text-[10px] px-2 py-1'
    : `rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        isDark ? 'bg-rose-500/15 text-rose-100 hover:bg-rose-500/25' : 'bg-rose-500/10 text-rose-700 hover:bg-rose-500/20'
      }`;
  const renderShortcutChips = (combos: ShortcutCombo[]) => {
    if (!combos.length) {
      return (
        <span className={`text-[11px] ${isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/45' : 'text-zinc-500'}`}>
          未设置
        </span>
      );
    }
    return combos.map((combo) => (
      <kbd key={formatShortcutCombo(combo)} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${kbdCls}`}>
        {formatShortcutCombo(combo)}
      </kbd>
    ));
  };
  const readonlyMouseShortcuts = [
    ['鼠标拖拽连接桩', '连接节点'],
    [`拖线中 ${shortcutText('connection.pan-mode')}`, '开启/关闭连线导航模式'],
    ['左键拖动空白', '平移画布'],
    ['Ctrl + 左键拖动', '框选多个节点'],
    ['中键长按空白', '打开节点圆盘'],
    ['右键点击节点 / 选区', '弹出菜单'],
    ['滚轮 / 触控板', '缩放画布'],
    [`${shortcutText('connection.pan-mode')} + 拖拽`, '平移画布(备选)'],
  ];
  const radialDelayOptions = [
    { label: '快', value: 240 },
    { label: '标准', value: 320 },
    { label: '稳', value: 450 },
  ];
  const onRadialSlotDrop = (toIndex: number) => {
    if (draggingRadialSlot === null) return;
    moveRadialSlot(draggingRadialSlot, toIndex);
    setDraggingRadialSlot(null);
  };
  const closeShortcutPanel = () => {
    setHelpOpen(false);
    setRecordingActionId(null);
    setShortcutMessage('');
    setDraggingRadialSlot(null);
  };
  const runAlignAction = (action: NodeAlignAction) => {
    onAlignSelection(action);
    setAlignOpen(false);
  };

  const alignPanelButton = (
    action: NodeAlignAction,
    label: string,
    Icon: typeof AlignStartVertical,
    minCount = 2,
  ) => {
    const disabled = selectedCount < minCount;
    return (
      <button
        type="button"
        className={`${compactBtnCls} flex items-center justify-center gap-1 ${disabled ? disabledCls : ''}`}
        onClick={() => runAlignAction(action)}
        title={disabled ? `至少选择 ${minCount} 个节点` : label}
      >
        <Icon size={13} />
        <span>{label}</span>
      </button>
    );
  };

  const runningCls = isPixel
    ? isRunning
      ? 'bg-[var(--px-mint)] text-[var(--px-ink)] hover:bg-[var(--px-mint)]'
      : 'text-[var(--px-mint-deep)] hover:bg-[var(--px-mint)]/40'
    : isRunning
      ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25'
      : isDark
      ? 'text-emerald-300 hover:bg-emerald-500/15'
      : 'text-emerald-600 hover:bg-emerald-500/10';

  return (
    <div className="t8-canvas-toolbar absolute top-3 right-3 z-20 flex items-start gap-2 select-none">
      <div className={containerCls}>
        {/* 批量运行 */}
        {isRunning ? (
          <button
            className={`${baseBtn} ${runningCls}`}
            onClick={onCancelRun}
            title={t('toolbar.stopRun', { done: batchDone, total: batchTotal })}
          >
            <Square size={14} fill="currentColor" />
            {batchTotal > 0 && (
              <span
                className={
                  isPixel
                    ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-yellow)] text-[var(--px-ink)] font-bold'
                    : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-emerald-500 text-black'
                }
              >
                {batchDone}/{batchTotal}
              </span>
            )}
          </button>
        ) : (
          <button
            className={`${baseBtn} ${runningCls}`}
            onClick={onRunAll}
            title={t('toolbar.runAll')}
          >
            <Play size={15} fill="currentColor" />
          </button>
        )}

        {/* 吸附开关 */}
        <button
          className={`${baseBtn} ${
            snapEnabled
              ? isPixel
                ? 'bg-[var(--px-yellow)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-amber-300 bg-amber-500/15'
                  : 'text-amber-600 bg-amber-500/10'
              : ''
          }`}
          onClick={onToggleSnap}
          title={snapEnabled ? t('toolbar.snapOff') : t('toolbar.snapOn')}
        >
          <Magnet size={15} />
        </button>
        <div className="relative" ref={alignRef}>
          <button
            className={`${baseBtn} ${selectedCount === 0 ? disabledCls : ''}`}
            onClick={() => setAlignOpen((v) => !v)}
            title={selectedCount > 0 ? t('toolbar.alignCount', { count: selectedCount }) : t('toolbar.alignSelect')}
            aria-label={t('toolbar.align')}
          >
            <LayoutGrid size={15} />
          </button>
          {alignOpen && selectedCount > 0 && (
            <div
              data-canvas-floating-ui="align-menu"
              className={
                isPixel
                  ? 'absolute right-0 mt-1.5 w-72 px-card p-2'
                  : `absolute right-0 mt-1.5 w-72 rounded-lg border p-2 shadow-xl ${
                      isDark ? 'border-white/10 bg-zinc-950/95 text-zinc-100' : 'border-black/10 bg-white text-zinc-900'
                    }`
              }
            >
              <div className={`mb-2 px-1 text-[11px] font-bold ${isPixel ? 'text-[var(--px-ink)]' : isDark ? 'text-white/70' : 'text-zinc-600'}`}>
                对齐选区
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {alignPanelButton('align-left', '左', AlignStartVertical)}
                {alignPanelButton('align-center-x', '水平中', AlignCenterVertical)}
                {alignPanelButton('align-right', '右', AlignEndVertical)}
                {alignPanelButton('align-top', '上', AlignStartHorizontal)}
                {alignPanelButton('align-center-y', '垂直中', AlignCenterHorizontal)}
                {alignPanelButton('align-bottom', '下', AlignEndHorizontal)}
              </div>
              <div className={`my-2 h-px ${isPixel ? 'bg-[var(--px-ink)]/25' : isDark ? 'bg-white/10' : 'bg-black/10'}`} />
              <div className="grid grid-cols-2 gap-1.5">
                {alignPanelButton('distribute-x', '水平等距', AlignHorizontalSpaceBetween, 3)}
                {alignPanelButton('distribute-y', '垂直等距', AlignVerticalSpaceBetween, 3)}
                {alignPanelButton('snap-grid', '吸附网格', Magnet, 1)}
                {alignPanelButton('arrange-grid', '整理网格', Grid3x3, 2)}
              </div>
            </div>
          )}
        </div>
        <button
          className={`${baseBtn} ${
            completionSoundEnabled
              ? isPixel
                ? 'bg-[var(--px-mint)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-sky-300 bg-sky-500/15'
                  : 'text-sky-600 bg-sky-500/10'
              : ''
          }`}
          onClick={toggleCompletionSound}
          title={completionSoundEnabled ? t('toolbar.soundOff') : t('toolbar.soundOn')}
          aria-label={completionSoundEnabled ? t('toolbar.soundOff') : t('toolbar.soundOn')}
          aria-pressed={completionSoundEnabled}
        >
          {completionSoundEnabled ? <Bell size={15} /> : <BellOff size={15} />}
        </button>
        <button
          className={`${baseBtn} ${
            outputMaterialPersistenceEnabled
              ? isPixel
                ? 'bg-[var(--px-mint)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-violet-200 bg-violet-500/20'
                  : 'text-violet-700 bg-violet-500/10'
              : ''
          }`}
          onClick={onToggleOutputMaterialPersistence}
          title={
            outputMaterialPersistenceEnabled
              ? t('toolbar.persistenceOffDetail')
              : t('toolbar.persistenceOnDetail')
          }
          aria-label={outputMaterialPersistenceEnabled ? t('toolbar.persistenceOff') : t('toolbar.persistenceOn')}
          aria-pressed={outputMaterialPersistenceEnabled}
        >
          <Archive size={15} />
        </button>
        <button
          className={`${baseBtn} ${
            historyOpen
              ? isPixel
                ? 'bg-[var(--px-mint)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-cyan-200 bg-cyan-500/20'
                  : 'text-cyan-700 bg-cyan-500/10'
              : ''
          }`}
          onClick={onToggleHistory}
          title={historyCount > 0 ? t('toolbar.historyCount', { count: historyCount }) : t('toolbar.history')}
          aria-label={t('toolbar.history')}
          aria-pressed={historyOpen}
        >
          <History size={15} />
          {historyCount > 0 && (
            <span
              className={
                isPixel
                  ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-yellow)] text-[var(--px-ink)] font-bold'
                  : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full bg-cyan-500 text-black font-bold'
              }
            >
              {historyCount > 99 ? '99+' : historyCount}
            </span>
          )}
        </button>
        <button
          className={baseBtn}
          onClick={onOpenVibeXWorkbench}
          title={t('toolbar.openVibex')}
          aria-label={t('toolbar.openVibex')}
        >
          <Clapperboard size={15} />
        </button>
        <button
          className={baseBtn}
          onClick={onCreateVibeXNode}
          title={t('toolbar.createVibexDetail')}
          aria-label={t('toolbar.createVibex')}
        >
          <Clapperboard size={15} />
          <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-cyan-400 ring-1 ring-white" />
        </button>
        <button
          className={baseBtn}
          onClick={onCreateGenerationTarget}
          title={t('toolbar.generationTargetDetail')}
          aria-label={t('toolbar.generationTarget')}
        >
          <ScanLine size={15} />
        </button>
        <button
          className={baseBtn}
          onClick={onFindNodeById}
          title={t('toolbar.findNode')}
          aria-label={t('toolbar.findNode')}
        >
          <Search size={15} />
        </button>
        <button
          className={baseBtn}
          onClick={onExportResourcePackage}
          title={t('toolbar.exportResourcesDetail')}
          aria-label={t('toolbar.exportResources')}
        >
          <PackageOpen size={15} />
        </button>

        <div className={sep} />

        {/* Undo / Redo */}
        <button
          className={`${baseBtn} ${!canUndo ? disabledCls : ''}`}
          onClick={onUndo}
          title={t('toolbar.undo', { shortcut: shortcutText('canvas.undo') })}
        >
          <Undo2 size={16} />
        </button>
        <button
          className={`${baseBtn} ${!canRedo ? disabledCls : ''}`}
          onClick={onRedo}
          title={t('toolbar.redo', { shortcut: shortcutText('canvas.redo') })}
        >
          <Redo2 size={16} />
        </button>

        <div className={sep} />

        {/* Copy / Paste / Delete */}
        <button
          className={`${baseBtn} ${selectedCount === 0 ? disabledCls : ''}`}
          onClick={onCopy}
          title={`${t('toolbar.copy', { shortcut: shortcutText('canvas.copy') })}${selectedCount > 0 ? t('toolbar.copyCount', { count: selectedCount }) : ''}`}
        >
          <Copy size={16} />
          {selectedCount > 0 && (
            <span
              className={
                isPixel
                  ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-pink)] text-[var(--px-ink)] font-bold'
                  : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-amber-500 text-black'
              }
            >
              {selectedCount}
            </span>
          )}
        </button>
        <button
          className={`${baseBtn} ${clipboardCount === 0 ? disabledCls : ''}`}
          onClick={onPaste}
          title={`${t('toolbar.paste', { shortcut: shortcutText('canvas.paste') })}${clipboardCount > 0 ? t('toolbar.clipboardCount', { count: clipboardCount }) : ''}`}
        >
          <ClipboardPaste size={16} />
        </button>
        <button
          className={`${baseBtn} ${selectedCount === 0 ? disabledCls : ''}`}
          onClick={onDelete}
          title={t('toolbar.remove', { shortcut: shortcutText('canvas.delete') })}
        >
          <Trash2 size={16} />
        </button>

        <div className={sep} />

        {/* Import / Export */}
        <button className={baseBtn} onClick={onImport} title={t('toolbar.importJson')}>
          <Upload size={16} />
        </button>
        <button className={baseBtn} onClick={onExport} title={t('toolbar.exportJson')}>
          <Download size={16} />
        </button>

        <div className={sep} />

        {/* 模板 */}
        <div className="relative" ref={tplRef}>
          <button
            className={baseBtn}
            onClick={() => setTplOpen((v) => !v)}
            title={t('toolbar.templates')}
          >
            <Sparkles size={16} />
          </button>
          {tplOpen && (
            <div
              className={
                isPixel
                  ? 'absolute right-0 mt-1.5 w-64 px-card overflow-hidden'
                  : `absolute right-0 mt-1.5 w-64 rounded-lg shadow-xl border overflow-hidden ${
                      isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-black/10'
                    }`
              }
            >
              <div
                className={
                  isPixel
                    ? 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider px-group-title bg-[var(--px-muted)] border-b-2 border-[var(--px-ink)]'
                    : `px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${
                        isDark ? 'text-white/50 bg-white/5' : 'text-zinc-500 bg-black/5'
                      }`
                }
              >
                {t('toolbar.chooseTemplate')}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {CANVAS_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      onApplyTemplate(tpl);
                      setTplOpen(false);
                    }}
                    className={
                      isPixel
                        ? 'w-full text-left px-3 py-2 hover:bg-[var(--px-muted)]'
                        : `w-full text-left px-3 py-2 ${
                            isDark ? 'hover:bg-white/10 text-zinc-100' : 'hover:bg-black/5 text-zinc-800'
                          }`
                    }
                  >
                    <div className="text-xs font-medium">{tpl.name}</div>
                    <div
                      className={
                        isPixel
                          ? 'text-[10px] mt-0.5 text-[var(--px-ink-soft)]'
                          : `text-[10px] mt-0.5 ${isDark ? 'text-white/50' : 'text-zinc-500'}`
                      }
                    >
                      {tpl.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 帮助 */}
        <button
          className={baseBtn}
          onClick={() => {
            setShortcutMessage('');
            setHelpOpen(true);
          }}
          title={t('toolbar.shortcuts')}
        >
          <HelpCircle size={16} />
        </button>

        {children}

        {/* 终端 */}
        <button
          className={`${baseBtn} ${
            termOpen
              ? isPixel
                ? 'bg-[var(--px-mint)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-emerald-300 bg-emerald-500/15'
                  : 'text-emerald-600 bg-emerald-500/10'
              : ''
          }`}
          onClick={toggleTerm}
          title={termOpen ? t('toolbar.terminalClose') : `${t('toolbar.terminalOpen')}${termUnread > 0 ? t('toolbar.unread', { count: termUnread }) : ''}`}
        >
          <TerminalIcon size={15} />
          {!termOpen && termUnread > 0 && (
            <span
              className={
                isPixel
                  ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-pink)] text-[var(--px-ink)] font-bold'
                  : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-rose-500 text-white'
              }
            >
              {termUnread}
            </span>
          )}
        </button>

        {endControl ? (
          <div className="t8-canvas-toolbar__end-control" data-canvas-toolbar-end-control="true">
            {endControl}
          </div>
        ) : null}
      </div>

      {/* 快捷键设置弹窗 */}
      {helpOpen && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${
            isPixel ? 'px-modal-mask' : 'bg-black/40'
          }`}
          onClick={closeShortcutPanel}
        >
          <div
            className={
              isPixel
                ? 'w-[min(760px,calc(100vw-32px))] px-card'
                : `w-[min(760px,calc(100vw-32px))] rounded-lg shadow-2xl border ${
                    isDark ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-black/10 text-zinc-900'
                  }`
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                isPixel
                  ? 'border-[var(--px-ink)]'
                  : isDark
                    ? 'border-white/10'
                    : 'border-black/10'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <HelpCircle size={16} />
                快捷键设置
              </div>
              <button
                onClick={closeShortcutPanel}
                className={
                  isPixel
                    ? 'px-btn px-btn--icon px-btn--ghost'
                    : `p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`
                }
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs max-h-[72vh] overflow-y-auto">
              <div
                className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${
                  isPixel
                    ? 'bg-[var(--px-muted)] border-2 border-[var(--px-ink)] rounded-[10px]'
                    : isDark
                      ? 'bg-white/5 rounded-md'
                      : 'bg-black/5 rounded-md'
                }`}
              >
                <div className={isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/65' : 'text-zinc-600'}>
                  点击“录制”后直接按新的组合键；Esc 取消。冲突或浏览器保留键会提示，不会覆盖。
                </div>
                <button
                  type="button"
                  className={compactBtnCls}
                  onClick={() => {
                    if (!window.confirm('恢复全部快捷键为默认值？')) return;
                    resetAllShortcuts();
                    setRecordingActionId(null);
                    setShortcutMessage('已恢复全部默认快捷键。');
                  }}
                >
                  全部恢复默认
                </button>
              </div>

              {shortcutMessage && (
                <div
                  className={`px-3 py-2 rounded text-[11px] ${
                    isPixel
                      ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)] text-[var(--px-ink)]'
                      : isDark
                        ? 'bg-amber-500/15 text-amber-100 border border-amber-400/25'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {shortcutMessage}
                </div>
              )}

              {groupedShortcutActions.map(([group, actions]) => (
                <section key={group} className="space-y-2">
                  <div
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      isPixel ? 'text-[var(--px-ink)]' : isDark ? 'text-white/55' : 'text-zinc-500'
                    }`}
                  >
                    {group}
                  </div>
                  <div className="space-y-2">
                    {actions.map((action) => {
                      const combos = shortcuts[action.id] || [];
                      const isRecording = recordingActionId === action.id;
                      return (
                        <div
                          key={action.id}
                          className={`grid grid-cols-1 sm:grid-cols-[minmax(130px,1fr)_minmax(150px,1.1fr)_auto] items-center gap-3 px-3 py-2 ${
                            isPixel
                              ? 'bg-[var(--px-surface)] border-2 border-[var(--px-ink)] rounded-[10px]'
                              : isDark
                                ? 'bg-white/5 border border-white/10 rounded-md'
                                : 'bg-white border border-black/10 rounded-md'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{action.label}</div>
                            <div
                              className={`mt-0.5 text-[10px] leading-snug ${
                                isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/50' : 'text-zinc-500'
                              }`}
                            >
                              {action.description}
                            </div>
                          </div>
                          <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                            {renderShortcutChips(combos)}
                          </div>
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              className={isRecording ? dangerBtnCls : compactBtnCls}
                              onClick={() => {
                                setRecordingActionId(action.id);
                                setShortcutMessage(`请按「${action.label}」的新快捷键，Esc 取消。`);
                              }}
                            >
                              {isRecording ? '按键中' : '录制'}
                            </button>
                            <button
                              type="button"
                              className={dangerBtnCls}
                              onClick={() => {
                                clearActionShortcuts(action.id);
                                setRecordingActionId(null);
                                setShortcutMessage(`已清空「${action.label}」快捷键。`);
                              }}
                            >
                              清空
                            </button>
                            <button
                              type="button"
                              className={compactBtnCls}
                              onClick={() => {
                                resetShortcutAction(action.id);
                                setRecordingActionId(null);
                                setShortcutMessage(`已恢复「${action.label}」默认快捷键。`);
                              }}
                            >
                              默认
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              <section className="space-y-2">
                <div
                  className={`flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide ${
                    isPixel ? 'text-[var(--px-ink)]' : isDark ? 'text-white/55' : 'text-zinc-500'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <MousePointer2 size={13} />
                    节点圆盘
                  </span>
                  <button
                    type="button"
                    className={compactBtnCls}
                    onClick={() => {
                      resetRadialMenu();
                      setShortcutMessage('已恢复节点圆盘默认配置。');
                    }}
                    title="恢复节点圆盘默认配置"
                  >
                    <RotateCcw size={12} />
                    默认
                  </button>
                </div>
                <div
                  className={`space-y-2 px-3 py-3 ${
                    isPixel
                      ? 'bg-[var(--px-muted)] border-2 border-[var(--px-ink)] rounded-[10px]'
                      : isDark
                        ? 'bg-white/5 border border-white/10 rounded-md'
                        : 'bg-black/5 border border-black/10 rounded-md'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/65' : 'text-zinc-600'}>
                      中键长按画布空白区后滑向方向，松开创建节点；拖动行可调整方向顺序。
                    </span>
                    <label className="inline-flex items-center gap-2 text-[11px]">
                      <span className={isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/55' : 'text-zinc-500'}>
                        长按
                      </span>
                      <select
                        className={
                          isPixel
                            ? 'px-input h-7 min-w-[76px] rounded-[8px] text-xs'
                            : `h-7 min-w-[76px] rounded border px-2 text-xs ${
                                isDark ? 'border-white/10 bg-zinc-950 text-white' : 'border-black/10 bg-white text-zinc-900'
                              }`
                        }
                        value={radialLongPressMs}
                        onChange={(event) => setRadialLongPressMs(Number(event.target.value))}
                      >
                        {radialDelayOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label} {item.value}ms
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {radialSlots.map((slot, index) => {
                      const meta = radialNodesByType.get(slot.nodeType);
                      const color = RADIAL_NODE_COLOR_HEX[meta?.color || 'slate'] || RADIAL_NODE_COLOR_HEX.slate;
                      return (
                        <div
                          key={slot.id}
                          draggable
                          onDragStart={() => setDraggingRadialSlot(index)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => onRadialSlotDrop(index)}
                          onDragEnd={() => setDraggingRadialSlot(null)}
                          className={`grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 px-2 py-2 ${
                            isPixel
                              ? 'bg-[var(--px-surface)] border-2 border-[var(--px-ink)] rounded-[10px]'
                              : isDark
                                ? 'bg-black/15 border border-white/10 rounded-md'
                                : 'bg-white border border-black/10 rounded-md'
                          } ${draggingRadialSlot === index ? 'opacity-55' : ''}`}
                        >
                          <GripVertical size={14} className="cursor-grab opacity-60" />
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={slot.enabled}
                              onChange={(event) => setRadialSlotEnabled(slot.id, event.target.checked)}
                              aria-label={`启用圆盘槽位 ${index + 1}`}
                            />
                            <span
                              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                              style={{
                                color: isPixel ? 'var(--px-ink)' : '#020617',
                                background: color,
                              }}
                            >
                              {index + 1}
                            </span>
                          </label>
                          <select
                            className={
                              isPixel
                                ? 'px-input min-w-0 rounded-[8px] px-2 py-1 text-xs'
                                : `min-w-0 rounded border px-2 py-1 text-xs ${
                                    isDark ? 'border-white/10 bg-zinc-950 text-white' : 'border-black/10 bg-white text-zinc-900'
                                  }`
                            }
                            value={slot.nodeType}
                            disabled={!slot.enabled}
                            onChange={(event) => setRadialSlotNodeType(slot.id, event.target.value as NodeType)}
                          >
                            {radialNodeOptions.map((node) => (
                              <option key={node.type} value={node.type}>
                                {node.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div
                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                    isPixel ? 'text-[var(--px-ink)]' : isDark ? 'text-white/55' : 'text-zinc-500'
                  }`}
                >
                  鼠标操作
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {readonlyMouseShortcuts.map(([input, action]) => (
                    <div
                      key={input}
                      className={`flex items-center justify-between gap-3 px-3 py-2 ${
                        isPixel
                          ? 'bg-[var(--px-muted)] border-2 border-[var(--px-ink)] rounded-[10px]'
                          : isDark
                            ? 'bg-white/5 rounded-md'
                            : 'bg-black/5 rounded-md'
                      }`}
                    >
                      <kbd className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${kbdCls}`}>
                        {input}
                      </kbd>
                      <span className={isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/65' : 'text-zinc-600'}>
                        {action}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
