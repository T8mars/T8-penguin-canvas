import { History, LoaderCircle, Minimize2, Plus, Settings, Sparkles, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CreatorAgentPanelV2Props } from './CreatorAgentPanelV2';

const loadCreatorAgentPanelV2 = () => import('./CreatorAgentPanelV2');
const CreatorAgentPanelV2 = lazy(loadCreatorAgentPanelV2);
const CREATOR_LAUNCHER_HINT_KEY = 't8.creator-agent.launcher-hint-dismissed.v1';
const CREATOR_SHELL_READINESS_SCHEMA = 't8-creator-agent-shell-readiness-receipt-v1';
const CREATOR_SHELL_TARGET_MS = 300;
const CREATOR_PANEL_MIN_SAFE_TOP = 86;
const CREATOR_PANEL_TOOLBAR_GAP = 8;

function measureCreatorPanelSafeTop() {
  const toolbar = document.querySelector<HTMLElement>('.t8-canvas-toolbar');
  if (!toolbar) return CREATOR_PANEL_MIN_SAFE_TOP;
  return Math.max(CREATOR_PANEL_MIN_SAFE_TOP, Math.ceil(toolbar.getBoundingClientRect().bottom + CREATOR_PANEL_TOOLBAR_GAP));
}

export default function CreatorAgentEntry(props: CreatorAgentPanelV2Props) {
  const { i18n } = useTranslation();
  const isChinese = i18n.language.toLowerCase().startsWith('zh');
  const [activated, setActivated] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null);
  const [showLauncherHint, setShowLauncherHint] = useState(false);
  const [panelSafeTop, setPanelSafeTop] = useState(CREATOR_PANEL_MIN_SAFE_TOP);
  const fallbackPanelId = useId();
  const launcherOpenedAtRef = useRef<number | null>(null);
  const fallbackShellRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-canvas-floating-ui="creator-agent-launcher-slot"]');
    setLauncherHost(host);
    return () => setLauncherHost(null);
  }, [props.canvasId]);

  useEffect(() => {
    const preload = () => { void loadCreatorAgentPanelV2(); };
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1_500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeout = setTimeout(preload, 900);
    return () => clearTimeout(timeout);
  }, []);

  useLayoutEffect(() => {
    if (!panelOpen) return undefined;
    const toolbar = document.querySelector<HTMLElement>('.t8-canvas-toolbar');
    const syncSafeTop = () => setPanelSafeTop((current) => {
      const next = measureCreatorPanelSafeTop();
      return current === next ? current : next;
    });
    syncSafeTop();
    const observer = typeof ResizeObserver === 'function' && toolbar
      ? new ResizeObserver(syncSafeTop)
      : null;
    if (observer && toolbar) observer.observe(toolbar);
    window.addEventListener('resize', syncSafeTop);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncSafeTop);
    };
  }, [panelOpen, props.canvasId]);

  useLayoutEffect(() => {
    const shell = fallbackShellRef.current;
    if (!activated || !panelOpen || !shell) return undefined;
    const startedAt = launcherOpenedAtRef.current ?? performance.now();
    const commitMs = Math.max(0, performance.now() - startedAt);
    shell.dataset.shellReadinessSchema = CREATOR_SHELL_READINESS_SCHEMA;
    shell.dataset.shellCommitMs = commitMs.toFixed(3);
    shell.dataset.shellTargetMs = String(CREATOR_SHELL_TARGET_MS);
    shell.dataset.shellReadinessStatus = 'pending-paint';
    const frame = window.requestAnimationFrame(() => {
      const paintReadyMs = Math.max(0, performance.now() - startedAt);
      shell.dataset.shellPaintReadyMs = paintReadyMs.toFixed(3);
      shell.dataset.shellReadinessStatus = paintReadyMs <= CREATOR_SHELL_TARGET_MS
        ? 'within-target'
        : 'over-target';
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activated, panelOpen]);

  useEffect(() => {
    try {
      setShowLauncherHint(window.localStorage.getItem(CREATOR_LAUNCHER_HINT_KEY) !== '1');
    } catch {
      setShowLauncherHint(false);
    }
  }, []);

  const dismissLauncherHint = () => {
    setShowLauncherHint(false);
    try { window.localStorage.setItem(CREATOR_LAUNCHER_HINT_KEY, '1'); } catch { /* Best effort. */ }
  };

  const launcherStyle = {
    '--creator-bg': props.themeTokens.panelBg,
    '--creator-surface': props.themeTokens.panelBgElevated,
    '--creator-surface-alt': props.themeTokens.panelBgMuted,
    '--creator-border': props.themeTokens.border,
    '--creator-text': props.themeTokens.textMain,
    '--creator-muted': props.themeTokens.textMuted,
    '--creator-accent': props.themeTokens.accent,
    '--creator-accent-text': props.themeTokens.accentText,
    '--creator-danger': props.themeTokens.danger,
    '--creator-success': props.themeTokens.success,
    '--creator-font': props.themeTokens.fontFamily,
    '--creator-panel-safe-top': `${panelSafeTop}px`,
  } as CSSProperties;

  if (activated) {
    const fallbackLauncher = (
      <button
        type="button"
        className="t8-creator-agent-launcher nodrag nopan"
        data-canvas-floating-ui="creator-agent-launcher"
        data-theme-visual={props.visualStyle}
        data-theme-mode={props.themeMode}
        data-status="running"
        style={launcherStyle}
        disabled
        title={isChinese ? '正在打开创作助手' : 'Opening Creator Agent'}
        aria-label={isChinese ? '正在打开创作助手' : 'Opening Creator Agent'}
        aria-controls={fallbackPanelId}
        aria-live="polite"
      >
        <span className="t8-creator-agent-launcher__label" aria-hidden="true">{isChinese ? '助手' : 'Agent'}</span>
        <span className="t8-creator-agent-launcher__glyph" aria-hidden="true"><LoaderCircle size={17} className="animate-spin" /></span>
      </button>
    );
    const fallback = (
      <>
        {launcherHost ? createPortal(fallbackLauncher, launcherHost) : fallbackLauncher}
        {panelOpen && createPortal(
          <aside
            ref={fallbackShellRef}
            id={fallbackPanelId}
            className="t8-creator-v2-panel is-loading-shell nodrag nopan nowheel"
            data-canvas-floating-ui="creator-agent-panel"
            data-shell-readiness-schema={CREATOR_SHELL_READINESS_SCHEMA}
            data-shell-commit-ms=""
            data-shell-paint-ready-ms=""
            data-shell-target-ms={CREATOR_SHELL_TARGET_MS}
            data-shell-readiness-status="pending-paint"
            data-theme-visual={props.visualStyle}
            data-theme-mode={props.themeMode}
            style={launcherStyle}
            role="dialog"
            aria-label={isChinese ? '创作助手' : 'Creator Agent'}
            aria-busy="true"
          >
            <header className="t8-creator-v2-header">
              <div><Sparkles size={17} aria-hidden="true" /><strong>{isChinese ? '创作助手' : 'Creator Agent'}</strong></div>
              <nav aria-label={isChinese ? '创作助手操作' : 'Creator Agent actions'}>
                <button type="button" disabled aria-label={isChinese ? '历史' : 'History'}><History size={16} /></button>
                <button type="button" disabled aria-label={isChinese ? '新对话' : 'New conversation'}><Plus size={16} /></button>
                <button type="button" disabled aria-label={isChinese ? '生成设置' : 'Generation settings'}><Settings size={16} /></button>
                <button type="button" disabled aria-label={isChinese ? '收起创作助手' : 'Minimize Creator Agent'}><Minimize2 size={16} /></button>
                <button type="button" disabled aria-label={isChinese ? '关闭' : 'Close'}><X size={17} /></button>
              </nav>
            </header>
            <ol className="t8-creator-v2-phases" aria-label={isChinese ? '创作进度' : 'Creation progress'}>
              {(isChinese ? ['想法', '方案', '素材', '制作', '挑选', '完成'] : ['Idea', 'Plan', 'Assets', 'Create', 'Choose', 'Done']).map((label, index) => (
                <li key={label} className={index === 0 ? 'is-current' : ''}><i aria-hidden="true">{index + 1}</i><span aria-hidden="true">{label}</span></li>
              ))}
            </ol>
            <div className="t8-creator-v2-transcript">
              <div className="t8-creator-v2-messages" role="status" aria-live="polite">
                <p className="t8-creator-v2-state"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{isChinese ? '正在打开创作…' : 'Opening your workspace…'}</p>
              </div>
            </div>
            <footer className="t8-creator-v2-composer is-loading" aria-hidden="true">
              <textarea rows={2} disabled />
              <div><button type="button" disabled><LoaderCircle size={16} className="animate-spin" /></button></div>
            </footer>
          </aside>,
          document.body,
        )}
      </>
    );
    return (
      <Suspense fallback={fallback}>
        <CreatorAgentPanelV2
          key={`${props.projectId}:${props.canvasId}`}
          {...props}
          initialOpen={panelOpen}
          onOpenChange={setPanelOpen}
          panelSafeTop={panelSafeTop}
          initialShellOpenedAt={launcherOpenedAtRef.current ?? undefined}
        />
      </Suspense>
    );
  }

  const launcher = (
    <button
      type="button"
      className="t8-creator-agent-launcher nodrag nopan"
      data-canvas-floating-ui="creator-agent-launcher"
      data-theme-visual={props.visualStyle}
      data-theme-mode={props.themeMode}
      data-status="idle"
      style={launcherStyle}
      title={isChinese ? '打开创作助手' : 'Open Creator Agent'}
      aria-label={isChinese ? '打开创作助手' : 'Open Creator Agent'}
      aria-controls={fallbackPanelId}
      aria-expanded="false"
      onClick={() => {
        setPanelSafeTop(measureCreatorPanelSafeTop());
        launcherOpenedAtRef.current = performance.now();
        dismissLauncherHint();
        setPanelOpen(true);
        setActivated(true);
      }}
    >
      <span className="t8-creator-agent-launcher__label" aria-hidden="true">{isChinese ? '助手' : 'Agent'}</span>
      <span className="t8-creator-agent-launcher__glyph" aria-hidden="true"><Sparkles size={17} /></span>
      <span className="t8-creator-agent-launcher__status" aria-hidden="true" />
    </button>
  );
  if (!launcherHost) return launcher;
  return createPortal(<>
    {launcher}
    {showLauncherHint && (
      <div className="t8-creator-agent-launcher-hint nodrag nopan" style={launcherStyle} role="status">
        <span>{isChinese ? '从这里开始创作' : 'Start creating here'}</span>
        <button type="button" aria-label={isChinese ? '关闭首次提示' : 'Dismiss first-use hint'} onClick={dismissLauncherHint}><X size={13} /></button>
      </div>
    )}
  </>, launcherHost);
}
