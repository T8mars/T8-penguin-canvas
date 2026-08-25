import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, RotateCcw, Sparkles, Zap } from 'lucide-react';
import { useCanvasPerformanceStore } from '../stores/performance';
import type { CanvasPerformanceDecision, CanvasPerformanceMode } from '../utils/canvasPerformance';

const OPTIONS: Array<{ mode: CanvasPerformanceMode; labelKey: string; detailKey: string }> = [
  { mode: 'auto', labelKey: 'auto', detailKey: 'automaticDetail' },
  { mode: 'balanced', labelKey: 'balanced', detailKey: 'balancedDetail' },
  { mode: 'performance', labelKey: 'performance', detailKey: 'performanceDetail' },
];

export default function CanvasPerformanceControl({ decision }: { decision: CanvasPerformanceDecision }) {
  const { t } = useTranslation('canvas');
  const mode = useCanvasPerformanceStore((state) => state.mode);
  const setMode = useCanvasPerformanceStore((state) => state.setMode);
  const restoreVisuals = useCanvasPerformanceStore((state) => state.restoreVisuals);
  const [open, setOpen] = useState(false);
  const effectiveLabel = t(`performance.${decision.effective}`);
  const label = mode === 'auto'
    ? t('performance.autoEffective', { effective: effectiveLabel })
    : t(`performance.${mode}`);
  const reason = t(`performance.reasons.${decision.reason}`, { defaultValue: decision.reasonLabel });

  return (
    <div className="t8-canvas-performance-control nodrag nopan" data-canvas-floating-ui="performance-control">
      <button
        type="button"
        className="t8-canvas-performance-control__trigger"
        onClick={() => setOpen((value) => !value)}
        title={`${label}：${reason}`}
        aria-expanded={open}
        aria-label={t('performance.aria', { label })}
      >
        {decision.effective === 'performance' ? <Zap size={13} /> : <Gauge size={13} />}
        <span>{label}</span>
      </button>
      {open ? (
        <div className="t8-canvas-performance-control__panel" role="dialog" aria-label={t('performance.title')}>
          <strong>{t('performance.title')}</strong>
          <p>{reason}</p>
          <div role="radiogroup" aria-label={t('performance.title')}>
            {OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={mode === option.mode}
                className={mode === option.mode ? 'is-active' : ''}
                onClick={() => setMode(option.mode)}
              >
                <span>{t(`performance.${option.labelKey}`)}</span>
                <small>{t(`performance.${option.detailKey}`)}</small>
              </button>
            ))}
          </div>
          {decision.effective === 'performance' ? (
            <button type="button" className="t8-canvas-performance-control__restore" onClick={restoreVisuals}>
              <Sparkles size={13} /> {t('performance.restoreVisuals')}
            </button>
          ) : (
            <button type="button" className="t8-canvas-performance-control__restore" onClick={() => setMode('auto')}>
              <RotateCcw size={13} /> {t('performance.restoreAuto')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
