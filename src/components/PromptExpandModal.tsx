import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCircle2, Copy, ListFilter, Wand2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createCompositionLeakSnapshot,
  createPlainInputRunSnapshot,
  isImeCompositionInput,
  stripCompositionLeak,
  type CompositionLeakSnapshot,
  type PlainInputRunSnapshot,
} from '../utils/imeComposition';

export type PromptExpandEditorKind = 'text' | 'json' | 'lines';

interface PromptExpandModalProps {
  open: boolean;
  title: string;
  value: string;
  onValueChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
  placeholder?: string;
  isDark: boolean;
  isPixel: boolean;
  readOnly?: boolean;
  mono?: boolean;
  editorKind?: PromptExpandEditorKind;
  children?: ReactNode;
}

function promptStats(value: string) {
  const text = String(value || '');
  const lines = text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
  return { chars: text.length, lines };
}

async function copyText(value: string, fallbackPrompt: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof window !== 'undefined') window.prompt(fallbackPrompt, value);
}

function formatJson(value: string) {
  const parsed = JSON.parse(value || '{}');
  return JSON.stringify(parsed, null, 2);
}

function validateJson(value: string) {
  JSON.parse(value || '{}');
}

function normalizeLines(value: string) {
  const seen = new Set<string>();
  const lines = String(value || '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join('\n');
}

export default function PromptExpandModal({
  open,
  title,
  value,
  onValueChange,
  onApply,
  onCancel,
  placeholder,
  isDark,
  isPixel,
  readOnly = false,
  mono = false,
  editorKind = 'text',
  children,
}: PromptExpandModalProps) {
  const { t } = useTranslation('nodes');
  const stats = useMemo(() => promptStats(value), [value]);
  const [toolMessage, setToolMessage] = useState('');
  const [toolMessageError, setToolMessageError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const lastPlainInputRef = useRef<PlainInputRunSnapshot | null>(null);
  const compositionLeakRef = useRef<CompositionLeakSnapshot | null>(null);

  useEffect(() => {
    if (open) {
      setToolMessage('');
      setToolMessageError(false);
      composingRef.current = false;
      lastPlainInputRef.current = null;
      compositionLeakRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (!readOnly) onApply();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onApply, onCancel, open, readOnly]);

  if (!open || typeof document === 'undefined') return null;

  const shellClass = isPixel
    ? 'px-card text-[var(--px-ink)]'
    : `rounded-lg border shadow-2xl ${
        isDark ? 'border-white/10 bg-zinc-950 text-zinc-100' : 'border-black/10 bg-white text-zinc-900'
      }`;
  const btnBase = isPixel
    ? 'px-btn px-btn--sm'
    : `inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors ${
        isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'
      }`;
  const primaryBtn = isPixel
    ? 'px-btn px-btn--sm px-btn--yellow'
    : 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-cyan-400 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-300';
  const textareaCls = isPixel
    ? 'px-input h-full w-full resize-none text-sm leading-relaxed'
    : `h-full w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed outline-none ${
        isDark
          ? 'border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-cyan-300/60'
          : 'border-black/10 bg-black/[0.03] text-zinc-900 placeholder:text-zinc-400 focus:border-cyan-500/70'
      } ${mono ? 'font-mono' : ''}`;
  const toolBtn = isPixel
    ? 'px-btn px-btn--sm'
    : `inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors ${
        isDark ? 'border-white/10 bg-white/[0.03] hover:bg-white/10' : 'border-black/10 bg-black/[0.02] hover:bg-black/5'
      }`;

  const handleFormatJson = () => {
    try {
      const formatted = formatJson(value);
      onValueChange(formatted);
      setToolMessageError(false);
      setToolMessage(t('shared.jsonFormatted'));
    } catch (error: any) {
      setToolMessageError(true);
      setToolMessage(t('shared.jsonInvalid', { message: error?.message || t('shared.parseFailed') }));
    }
  };

  const handleValidateJson = () => {
    try {
      validateJson(value);
      setToolMessageError(false);
      setToolMessage(t('shared.jsonValid'));
    } catch (error: any) {
      setToolMessageError(true);
      setToolMessage(t('shared.jsonInvalid', { message: error?.message || t('shared.parseFailed') }));
    }
  };

  const handleNormalizeLines = () => {
    onValueChange(normalizeLines(value));
    setToolMessageError(false);
    setToolMessage(t('shared.linesNormalized'));
  };

  const rememberPlainInput = (text: string, caret: number, data: string) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const snapshot = createPlainInputRunSnapshot({ text, caret, data, now });
    lastPlainInputRef.current = snapshot;
    if (composingRef.current && snapshot) {
      compositionLeakRef.current = createCompositionLeakSnapshot(lastPlainInputRef.current, now) || compositionLeakRef.current;
    }
  };

  const handleTextareaCompositionStart = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    compositionLeakRef.current = createCompositionLeakSnapshot(lastPlainInputRef.current, now);
    composingRef.current = true;
  };

  const handleTextareaCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    const fallbackValue = event.currentTarget.value;
    window.setTimeout(() => {
      let nextValue = textareaRef.current?.value ?? fallbackValue;
      const caret = textareaRef.current?.selectionEnd ?? nextValue.length;
      const fixed = stripCompositionLeak(nextValue, [], compositionLeakRef.current);
      if (fixed.changed) {
        nextValue = fixed.text;
        const nextCaret = Math.max(0, caret + fixed.caretDelta);
        if (textareaRef.current) {
          textareaRef.current.value = nextValue;
          window.requestAnimationFrame(() => textareaRef.current?.setSelectionRange(nextCaret, nextCaret));
        }
      }
      compositionLeakRef.current = null;
      lastPlainInputRef.current = null;
      composingRef.current = false;
      onValueChange(nextValue);
    }, 0);
  };

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const inputEvent = event.nativeEvent as InputEvent & { data?: string; inputType?: string };
    if (
      inputEvent?.inputType === 'insertText' &&
      /^[A-Za-z]$/.test(String(inputEvent.data || ''))
    ) {
      rememberPlainInput(nextValue, event.target.selectionEnd ?? nextValue.length, String(inputEvent.data));
    } else if (!composingRef.current && !isImeCompositionInput(event.nativeEvent)) {
      lastPlainInputRef.current = null;
    }
    onValueChange(nextValue);
  };

  return createPortal(
    <div
      data-canvas-floating-ui="prompt-expand-editor"
      className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/45 p-3"
      onMouseDown={onCancel}
    >
      <section
        className={`${shellClass} flex h-[min(82vh,860px)] w-[min(1080px,calc(100vw-24px))] flex-col overflow-hidden`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title || t('shared.expandPrompt')}
      >
        <header
          className={`flex items-center justify-between gap-3 px-4 py-3 ${
            isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'
          }`}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{title || t('shared.expandPrompt')}</div>
            <div className={`mt-0.5 text-[11px] ${isPixel ? 'text-[var(--px-ink)] opacity-70' : isDark ? 'text-white/45' : 'text-zinc-500'}`}>
              {t('shared.editorStats', { chars: stats.chars, lines: stats.lines })}
            </div>
          </div>
          <button type="button" className={btnBase} onClick={onCancel} title={t('shared.close')}>
            <X size={14} />
          </button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col p-4">
          {editorKind !== 'text' && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {editorKind === 'json' && (
                <>
                  <button type="button" className={toolBtn} onClick={handleFormatJson} disabled={readOnly}>
                    <Wand2 size={13} /> {t('shared.formatJson')}
                  </button>
                  <button type="button" className={toolBtn} onClick={handleValidateJson}>
                    <CheckCircle2 size={13} /> {t('shared.validateJson')}
                  </button>
                </>
              )}
              {editorKind === 'lines' && (
                <button type="button" className={toolBtn} onClick={handleNormalizeLines} disabled={readOnly}>
                  <ListFilter size={13} /> {t('shared.normalizeList')}
                </button>
              )}
              {toolMessage && (
                <span className={`text-[11px] ${toolMessageError ? 'text-red-400' : isDark ? 'text-cyan-200' : 'text-cyan-700'}`}>
                  {toolMessage}
                </span>
              )}
            </div>
          )}
          {children || (
            <textarea
              ref={textareaRef}
              autoFocus
              readOnly={readOnly}
              value={value}
              onBeforeInput={(event) => {
                if (isImeCompositionInput(event.nativeEvent)) composingRef.current = true;
              }}
              onCompositionStart={handleTextareaCompositionStart}
              onCompositionEnd={handleTextareaCompositionEnd}
              onChange={handleTextareaChange}
              placeholder={placeholder}
              className={textareaCls}
              style={{ paddingLeft: 10 }}
              spellCheck={false}
            />
          )}
        </main>

        <footer
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
            isPixel ? 'border-t-2 border-[var(--px-ink)]' : isDark ? 'border-t border-white/10' : 'border-t border-black/10'
          }`}
        >
          <div className={`text-[11px] ${isPixel ? 'text-[var(--px-ink)] opacity-70' : isDark ? 'text-white/45' : 'text-zinc-500'}`}>
            {readOnly ? t('shared.readOnlyField') : t('shared.writeBackHint')}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btnBase} onClick={() => copyText(value, t('shared.copyTextPrompt'))} title={t('shared.copyCurrent')}>
              <Copy size={13} /> {t('shared.copy')}
            </button>
            <button type="button" className={btnBase} onClick={onCancel}>
              {t('shared.cancel')}
            </button>
            <button type="button" className={`${primaryBtn} ${readOnly ? 'opacity-45' : ''}`} disabled={readOnly} onClick={onApply}>
              <Check size={13} /> {t('shared.done')}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
