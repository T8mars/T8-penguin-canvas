import { LoaderCircle, Sparkles } from 'lucide-react';
import { lazy, Suspense, useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CreatorAgentPanelV2Props } from './CreatorAgentPanelV2';

const CreatorAgentPanelV2 = lazy(() => import('./CreatorAgentPanelV2'));

export default function CreatorAgentEntry(props: CreatorAgentPanelV2Props) {
  const { i18n } = useTranslation();
  const isChinese = i18n.language.toLowerCase().startsWith('zh');
  const [activated, setActivated] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-canvas-floating-ui="creator-agent-launcher-slot"]');
    setLauncherHost(host);
    return () => setLauncherHost(null);
  }, [props.canvasId]);

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
  } as CSSProperties;

  if (activated) {
    const fallback = (
      <button
        type="button"
        className="t8-creator-agent-launcher nodrag nopan"
        data-canvas-floating-ui="creator-agent-launcher"
        data-theme-visual={props.visualStyle}
        data-theme-mode={props.themeMode}
        data-status="running"
        style={launcherStyle}
        disabled
        aria-label={isChinese ? '正在打开创作 Agent' : 'Opening Creator Agent'}
        aria-live="polite"
      >
        <span className="t8-creator-agent-launcher__label" aria-hidden="true">AI</span>
        <span className="t8-creator-agent-launcher__glyph" aria-hidden="true"><LoaderCircle size={17} className="animate-spin" /></span>
      </button>
    );
    return (
      <Suspense fallback={launcherHost ? createPortal(fallback, launcherHost) : fallback}>
        <CreatorAgentPanelV2
          key={`${props.projectId}:${props.canvasId}`}
          {...props}
          initialOpen={panelOpen}
          onOpenChange={setPanelOpen}
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
      aria-label={isChinese ? '打开创作 Agent' : 'Open Creator Agent'}
      onClick={() => { setPanelOpen(true); setActivated(true); }}
    >
      <span className="t8-creator-agent-launcher__label" aria-hidden="true">AI</span>
      <span className="t8-creator-agent-launcher__glyph" aria-hidden="true"><Sparkles size={17} /></span>
      <span className="t8-creator-agent-launcher__status" aria-hidden="true" />
    </button>
  );
  return launcherHost ? createPortal(launcher, launcherHost) : launcher;
}
