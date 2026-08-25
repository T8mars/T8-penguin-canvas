import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type CompositionEvent as ReactCompositionEvent,
  type InputEvent as ReactInputEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { Library, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../stores/theme';
import { useShortcutStore } from '../stores/shortcuts';
import { formatShortcutList, matchesAnyShortcut } from '../utils/keyboardShortcuts';
import {
  createCompositionLeakSnapshot,
  createPlainInputRunSnapshot,
  isImeCompositionInput,
  stripCompositionLeak,
  type CompositionLeakSnapshot,
  type PlainInputRunSnapshot,
} from '../utils/imeComposition';
import type { PromptTemplateKind } from '../data/promptTemplateLibrary';
import PromptExpandModal, { type PromptExpandEditorKind } from './PromptExpandModal';
import PromptTemplateLibraryModal from './PromptTemplateLibraryModal';

interface PromptTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  title: string;
  containerClassName?: string;
  isDark?: boolean;
  isPixel?: boolean;
  mono?: boolean;
  editorKind?: PromptExpandEditorKind;
  promptTemplateKind?: PromptTemplateKind | false;
}

const PromptTextarea = forwardRef<HTMLTextAreaElement, PromptTextareaProps>(function PromptTextarea({
  value,
  onValueChange,
  title,
  containerClassName = 'relative',
  isDark: propIsDark,
  isPixel: propIsPixel,
  mono = false,
  editorKind = 'text',
  promptTemplateKind = false,
  className,
  style: textareaStyle,
  onKeyDown,
  onBeforeInput,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  readOnly,
  ...rest
}: PromptTextareaProps, forwardedRef) {
  const { t } = useTranslation('nodes');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const lastPlainInputRef = useRef<PlainInputRunSnapshot | null>(null);
  const compositionLeakRef = useRef<CompositionLeakSnapshot | null>(null);
  const { theme, style: themeStyle } = useThemeStore();
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const expandCombos = shortcuts['editor.expand-prompt'];
  const isDark = propIsDark ?? theme === 'dark';
  const isPixel = propIsPixel ?? themeStyle === 'pixel';
  const [expanded, setExpanded] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');
  const [draft, setDraft] = useState(value || '');
  const shortcutText = formatShortcutList(expandCombos);
  const templateEnabled = promptTemplateKind !== false;
  const effectiveTemplateKind = promptTemplateKind || 'image';

  useEffect(() => {
    if (!composingRef.current) setLocalValue(value || '');
  }, [value]);

  const commitValue = (nextValue: string) => {
    setLocalValue(nextValue);
    if (!readOnly) onValueChange(nextValue);
  };

  const openExpanded = () => {
    setDraft(localValue || '');
    setExpanded(true);
  };

  const closeExpanded = () => {
    setExpanded(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const applyExpanded = () => {
    commitValue(draft);
    closeExpanded();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) {
      onKeyDown?.(event);
      return;
    }
    if (matchesAnyShortcut(expandCombos, event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      openExpanded();
      return;
    }
    onKeyDown?.(event);
  };

  const handleBeforeInput = (event: ReactInputEvent<HTMLTextAreaElement>) => {
    if (isImeCompositionInput(event.nativeEvent)) composingRef.current = true;
    onBeforeInput?.(event);
  };

  const rememberPlainInput = (text: string, caret: number, data: string) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const snapshot = createPlainInputRunSnapshot({ text, caret, data, now });
    lastPlainInputRef.current = snapshot;
    if (composingRef.current && snapshot) {
      compositionLeakRef.current = createCompositionLeakSnapshot(lastPlainInputRef.current, now) || compositionLeakRef.current;
    }
  };

  const handleCompositionStart = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    compositionLeakRef.current = createCompositionLeakSnapshot(lastPlainInputRef.current, now);
    composingRef.current = true;
    onCompositionStart?.(event);
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    onCompositionEnd?.(event);
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
      commitValue(nextValue);
    }, 0);
  };

  const expandButtonCls = isPixel
    ? 'px-btn px-btn--icon px-btn--ghost'
    : `rounded border p-1 shadow-sm ${
        isDark ? 'border-white/10 bg-zinc-950/80 text-white/70 hover:text-white' : 'border-black/10 bg-white/90 text-zinc-600 hover:text-zinc-900'
      }`;

  const setTextareaRef = (el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (typeof forwardedRef === 'function') {
      forwardedRef(el);
    } else if (forwardedRef) {
      (forwardedRef as MutableRefObject<HTMLTextAreaElement | null>).current = el;
    }
  };

  return (
    <div className={containerClassName}>
      <textarea
        {...rest}
        ref={setTextareaRef}
        value={localValue}
        readOnly={readOnly}
        onBeforeInput={handleBeforeInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onChange={(event) => {
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
          setLocalValue(nextValue);
          if (composingRef.current || isImeCompositionInput(event.nativeEvent)) return;
          if (!readOnly) onValueChange(nextValue);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        style={{
          ...textareaStyle,
          paddingLeft: textareaStyle?.paddingLeft ?? 10,
          paddingRight: templateEnabled ? (textareaStyle?.paddingRight ?? 64) : textareaStyle?.paddingRight,
        }}
        spellCheck={false}
      />
      {templateEnabled && (
        <button
          type="button"
          data-prompt-template-trigger
          className={`nodrag nopan absolute top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center ${expandButtonCls}`}
          style={{ right: 34 }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setTemplateOpen(true);
          }}
          title={t('shared.promptLibrary')}
          aria-label={t('shared.promptLibrary')}
        >
          <Library size={12} />
        </button>
      )}
      <button
        type="button"
        data-prompt-expand-trigger
        className={`nodrag nopan absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center ${expandButtonCls}`}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openExpanded();
        }}
        title={t('shared.expandEditorWithShortcut', { shortcut: shortcutText })}
        aria-label={t('shared.expandEditor')}
      >
        <Maximize2 size={12} />
      </button>
      <PromptExpandModal
        open={expanded}
        title={title}
        value={draft}
        onValueChange={setDraft}
        onApply={applyExpanded}
        onCancel={closeExpanded}
        placeholder={typeof placeholder === 'string' ? placeholder : undefined}
        isDark={isDark}
        isPixel={isPixel}
        readOnly={!!readOnly}
        mono={mono || editorKind === 'json'}
        editorKind={editorKind}
      />
      <PromptTemplateLibraryModal
        open={templateOpen}
        initialKind={effectiveTemplateKind}
        value={value || ''}
        onApply={(nextValue) => {
          commitValue(nextValue);
        }}
        onClose={() => {
          setTemplateOpen(false);
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        isDark={isDark}
        isPixel={isPixel}
      />
    </div>
  );
});

export default PromptTextarea;
