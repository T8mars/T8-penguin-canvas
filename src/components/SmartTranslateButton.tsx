import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import NodeVisible from '../i18n/NodeVisible';
import { runRhTextTranslation } from '../services/rhToolboxCapabilities';
import { logBus } from '../stores/logs';
import {
  SMART_TRANSLATION_RECORD_SCHEMA,
  type SmartTranslationRecord,
} from '../utils/smartTranslation';

interface Props {
  text: string;
  nodeId: string;
  protectedTerms?: string[];
  lastRecord?: SmartTranslationRecord | null;
  onTranslated: (translatedText: string, record: SmartTranslationRecord) => void;
  onRecord?: (record: SmartTranslationRecord) => void;
  className?: string;
  title?: string;
}

function recordTitle(record?: SmartTranslationRecord | null): string {
  if (!record) return '';
  if (record.status === 'success') return '上次智能翻译已完成';
  if (record.status === 'stale') return record.error || '原文已变化，上次结果未覆盖';
  return record.error || '上次智能翻译失败';
}

const SmartTranslateButton = ({
  text,
  nodeId,
  protectedTerms = [],
  lastRecord,
  onTranslated,
  onRecord,
  className = '',
  title = '智能翻译：中英文自动互译，其他语言译为中文',
}: Props) => {
  const latestTextRef = useRef(text);
  latestTextRef.current = text;
  const [busy, setBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const disabled = busy || !String(text || '').trim();
  const persistedTitle = recordTitle(lastRecord);

  const handleTranslate = async () => {
    if (disabled) return;
    const sourceText = String(text || '').trim();
    const startedAt = new Date().toISOString();
    const source = `smart-translate:${nodeId}`;
    setBusy(true);
    setRuntimeMessage('正在调用 RH 智能翻译');
    try {
      const result = await runRhTextTranslation({
        text: sourceText,
        protectedTerms,
        onProgress: (progress) => setRuntimeMessage(progress.message),
      });
      const completedAt = new Date().toISOString();
      if (String(latestTextRef.current || '').trim() !== sourceText) {
        const record: SmartTranslationRecord = {
          schema: SMART_TRANSLATION_RECORD_SCHEMA,
          version: 1,
          status: 'stale',
          sourceText,
          translatedText: result.translatedText,
          provider: 'runninghub',
          capability: 'text.translate',
          toolId: result.tool.id,
          webappId: result.tool.webappId,
          taskId: result.taskId,
          requestId: result.result.requestId,
          startedAt,
          completedAt,
          error: '翻译期间原文已变化，结果已保留但未覆盖当前文本',
        };
        onRecord?.(record);
        setRuntimeMessage(record.error || '原文已变化');
        logBus.warn(record.error || '翻译结果已过期', source);
        return;
      }
      const record: SmartTranslationRecord = {
        schema: SMART_TRANSLATION_RECORD_SCHEMA,
        version: 1,
        status: 'success',
        sourceText,
        translatedText: result.translatedText,
        provider: 'runninghub',
        capability: 'text.translate',
        toolId: result.tool.id,
        webappId: result.tool.webappId,
        taskId: result.taskId,
        requestId: result.result.requestId,
        startedAt,
        completedAt,
      };
      onTranslated(result.translatedText, record);
      setRuntimeMessage('智能翻译完成');
      logBus.success('智能翻译完成', source);
    } catch (error: any) {
      const message = error?.message || '智能翻译失败';
      const record: SmartTranslationRecord = {
        schema: SMART_TRANSLATION_RECORD_SCHEMA,
        version: 1,
        status: 'error',
        sourceText,
        provider: 'runninghub',
        capability: 'text.translate',
        startedAt,
        completedAt: new Date().toISOString(),
        error: message,
      };
      onRecord?.(record);
      setRuntimeMessage(message);
      logBus.error(message, source);
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeVisible>
      <button
      type="button"
      data-smart-translate-trigger
      className={`nodrag nopan inline-flex h-6 min-w-6 items-center justify-center rounded border border-lime-400/30 bg-lime-500/15 px-1 text-[11px] font-bold text-lime-200 shadow-sm transition hover:bg-lime-500/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      disabled={disabled}
      aria-label="智能翻译"
      aria-busy={busy}
      title={busy ? runtimeMessage : runtimeMessage || persistedTitle || title}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleTranslate();
      }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : '译'}
      </button>
    </NodeVisible>
  );
};

export default SmartTranslateButton;
