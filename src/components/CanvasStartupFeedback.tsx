import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CanvasStartupReadiness, CanvasStartupStage } from '../utils/canvasStartupReadiness';

interface CanvasStartupFeedbackProps {
  readiness: CanvasStartupReadiness;
  notice: { id: number; text: string } | null;
  retrying: boolean;
  onRetry: () => void;
}

const STEP_STAGE: Record<'backend' | 'catalog' | 'document' | 'flow', CanvasStartupStage[]> = {
  backend: ['connecting', 'backend-error'],
  catalog: ['catalog', 'catalog-error'],
  document: ['document', 'canvas-error'],
  flow: ['flow'],
};

function stepState(
  key: keyof typeof STEP_STAGE,
  stage: CanvasStartupStage,
): 'pending' | 'active' | 'done' | 'error' {
  const order: Array<keyof typeof STEP_STAGE> = ['backend', 'catalog', 'document', 'flow'];
  const activeIndex = order.findIndex((item) => STEP_STAGE[item].includes(stage));
  const index = order.indexOf(key);
  if (stage === 'ready' || stage === 'empty') return 'done';
  if (index < activeIndex) return 'done';
  if (index > activeIndex || activeIndex < 0) return 'pending';
  return stage.endsWith('error') ? 'error' : 'active';
}

export default function CanvasStartupFeedback({
  readiness,
  notice,
  retrying,
  onRetry,
}: CanvasStartupFeedbackProps) {
  const { t } = useTranslation('shell');
  const previousStageRef = useRef<CanvasStartupStage>(readiness.stage);
  const [showReadyReceipt, setShowReadyReceipt] = useState(false);
  const [slow, setSlow] = useState(false);
  const [verySlow, setVerySlow] = useState(false);

  useEffect(() => {
    const previous = previousStageRef.current;
    previousStageRef.current = readiness.stage;
    if (readiness.stage !== 'ready' || previous === 'ready') return undefined;
    setShowReadyReceipt(true);
    const timer = window.setTimeout(() => setShowReadyReceipt(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [readiness.stage]);

  useEffect(() => {
    setSlow(false);
    setVerySlow(false);
    if (readiness.stage === 'ready' || readiness.stage === 'empty') return undefined;
    const slowTimer = window.setTimeout(() => setSlow(true), 5_000);
    const retryTimer = window.setTimeout(() => setVerySlow(true), 15_000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
    };
  }, [readiness.stage]);

  const showMainCard = !['ready', 'empty', 'canvas-error'].includes(readiness.stage);
  const showRetry = verySlow || readiness.stage.endsWith('error');
  const steps: Array<{ key: keyof typeof STEP_STAGE; label: string }> = [
    { key: 'backend', label: t('startup.steps.backend') },
    { key: 'catalog', label: t('startup.steps.catalog') },
    { key: 'document', label: t('startup.steps.document') },
    { key: 'flow', label: t('startup.steps.flow') },
  ];

  return (
    <div className="t8-canvas-startup-feedback" data-canvas-startup-stage={readiness.stage}>
      <div className="t8-canvas-startup-live" aria-live="polite" aria-atomic="true">
        {notice?.text || (showReadyReceipt ? t('startup.ready') : '')}
      </div>
      {notice && (
        <div key={notice.id} className="t8-canvas-startup-toast" role="status">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{notice.text}</span>
        </div>
      )}
      {!notice && showReadyReceipt && (
        <div className="t8-canvas-startup-ready" role="status">
          <Check size={15} aria-hidden="true" />
          <span>{t('startup.ready')}</span>
        </div>
      )}
      {showMainCard && (
        <section
          className="t8-canvas-startup-card"
          role={readiness.stage.endsWith('error') ? 'alert' : 'status'}
          aria-busy={!readiness.stage.endsWith('error')}
          aria-label={t('startup.title')}
        >
          <div className="t8-canvas-startup-card__title">
            {readiness.stage.endsWith('error')
              ? <TriangleAlert size={20} aria-hidden="true" />
              : <Loader2 size={20} className="animate-spin" aria-hidden="true" />}
            <strong>{readiness.stage.endsWith('error') ? t('startup.notReady') : t('startup.title')}</strong>
          </div>
          <div className="t8-canvas-startup-steps">
            {steps.map((step) => {
              const state = stepState(step.key, readiness.stage);
              return (
                <div key={step.key} className="t8-canvas-startup-step" data-state={state}>
                  {state === 'done' ? <Check size={14} aria-hidden="true" />
                    : state === 'active' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      : state === 'error' ? <TriangleAlert size={14} aria-hidden="true" />
                        : <Circle size={10} aria-hidden="true" />}
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
          {readiness.error && <p className="t8-canvas-startup-card__error">{readiness.error}</p>}
          {slow && !readiness.stage.endsWith('error') && (
            <p className="t8-canvas-startup-card__hint">{t('startup.slowHint')}</p>
          )}
          {showRetry && (
            <button type="button" className="t8-canvas-startup-retry" disabled={retrying} onClick={onRetry}>
              <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
              {retrying ? t('startup.retrying') : t('startup.retry')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
