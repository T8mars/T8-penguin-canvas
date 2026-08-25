import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Hash, Type } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import ResizableCorners from './ResizableCorners';
import { getCornerResizeBehavior } from '../../utils/nodeResizeBehavior';
import { normalizeRhNodeId } from '../../utils/rhTextBinding';
import MentionPromptInput from './MentionPromptInput';
import { rebaseMediaMentions, resolveMediaMentions, type MediaMention } from './mediaMentions';
import { useDownstreamMediaMaterials, useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useThemeStore } from '../../stores/theme';
import SmartTranslateButton from '../SmartTranslateButton';
import type { SmartTranslationRecord } from '../../utils/smartTranslation';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';

/**
 * 文本节点 - 提示词输入
 * 输出 data.prompt 给下游(图像/LLM 节点通过连接读取)
 *
 * v1.x: 固定宽 260 + textarea h-24
 * v2.x: 选中后可拖 4 角缩放 (ResizableCorners + xyflow NodeResizeControl);
 *       内部布局改为响应式 (width/height 100%), textarea 占所有剩余高度
 * v2.1: root 用本地 state 持有具体 px 尺寸 — 解决 width:'100%' + wrapper auto 形成百分比循环
 *       测量异常 (measured.width=0 → NodeResizeControl 算出 aspectRatio=0 → 只能纵向拉大) 的问题。
 *       同时 root 始终有具体 px → wrapper measured 准确 → handleBounds 准确, 连线稳定。
 */
function uniqueMentionMaterials(materials: Material[]): Material[] {
  const seen = new Set<string>();
  return materials.filter((material) => {
    const key = `${material.kind}:${material.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const TextNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const syncRafRef = useRef<{ first?: number; second?: number }>({});
  const d = data as any;
  const text = (d?.prompt as string) || '';
  const promptMentions: MediaMention[] = Array.isArray(d?.promptMentions) ? d.promptMentions : [];
  const upstream = useUpstreamMaterials(id);
  const downstreamMedia = useDownstreamMediaMaterials(id);
  const mentionMaterials = useMemo(
    () => uniqueMentionMaterials([
      ...upstream.images,
      ...upstream.videos,
      ...upstream.audios,
      ...downstreamMedia,
      ...upstream.texts,
    ]),
    [upstream.images, upstream.videos, upstream.audios, downstreamMedia, upstream.texts],
  );
  const resolvedPrompt = useMemo(
    () => resolveMediaMentions(text, promptMentions, mentionMaterials),
    [text, promptMentions, mentionMaterials],
  );
  const translationProtectedTerms = useMemo(
    () => Array.from(new Set(promptMentions.map((mention) => mention.token).filter(Boolean))),
    [promptMentions],
  );
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const rhNodeIdRaw = String((data as any)?.rhNodeId ?? '');
  const rhNodeId = normalizeRhNodeId(rhNodeIdRaw);
  const resizeBehavior = getCornerResizeBehavior('text');
  // 节点本地尺寸 state: 默认 (260, 由内容撑高) → 拖角后由 ResizableCorners onResize 同步具体 px
  const [size, setSize] = useState<{ w: number; h?: number }>({ w: 260 });

  const syncNodeInternals = useCallback(() => {
    if (syncRafRef.current.first) window.cancelAnimationFrame(syncRafRef.current.first);
    if (syncRafRef.current.second) window.cancelAnimationFrame(syncRafRef.current.second);

    syncRafRef.current.first = window.requestAnimationFrame(() => {
      updateNodeInternals(id);
      syncRafRef.current.second = window.requestAnimationFrame(() => updateNodeInternals(id));
    });

    return () => {
      if (syncRafRef.current.first) window.cancelAnimationFrame(syncRafRef.current.first);
      if (syncRafRef.current.second) window.cancelAnimationFrame(syncRafRef.current.second);
      syncRafRef.current = {};
    };
  }, [id, updateNodeInternals]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return syncNodeInternals();

    const cleanup = syncNodeInternals();
    const observer = new ResizeObserver(() => {
      syncNodeInternals();
    });
    observer.observe(el);

    return () => {
      cleanup();
      observer.disconnect();
    };
  }, [syncNodeInternals]);

  useLayoutEffect(() => syncNodeInternals(), [selected, size.w, size.h, syncNodeInternals]);

  useEffect(() => {
    if (!promptMentions.length) {
      if (d?.promptResolved) update({ promptResolved: '' });
      return;
    }
    if (d?.promptResolved !== resolvedPrompt) update({ promptResolved: resolvedPrompt });
  }, [d?.promptResolved, promptMentions.length, resolvedPrompt, update]);

  const handleResize = useCallback(
    (_e: unknown, params: ResizeParams) => {
      setSize({ w: params.width, h: params.height });
      syncNodeInternals();
    },
    [syncNodeInternals],
  );
  const handleRhNodeIdChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D+/g, '');
      update({ rhNodeId: digits });
    },
    [update],
  );
  const handleTranslationRecord = useCallback(
    (record: SmartTranslationRecord) => update({ smartTranslation: record }),
    [update],
  );
  const handleTranslated = useCallback(
    (translatedText: string, record: SmartTranslationRecord) => {
      const translatedMentions = rebaseMediaMentions(translatedText, promptMentions);
      update({
        prompt: translatedText,
        text: translatedText,
        promptMentions: translatedMentions,
        promptResolved: resolveMediaMentions(translatedText, translatedMentions, mentionMaterials),
        smartTranslation: record,
      });
    },
    [mentionMaterials, promptMentions, update],
  );

  if (canvasRenderMode === 'cold') {
    return (
      <div
        ref={rootRef}
        className="t8-node-cold-shell"
        data-t8-node-cold-shell="text"
        style={{ width: size.w, height: size.h ?? 168, minWidth: 220, minHeight: 140 }}
      >
        <Handle type="target" position={Position.Left} className="!border-0 !bg-sky-400" />
        <Handle type="source" position={Position.Right} className="!border-0 !bg-sky-400" />
        <div className="t8-node-cold-shell__header">
          <Type size={16} className="shrink-0 text-sky-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{t('text.title')}</strong>
            <small>{t('text.offscreen', { count: resolvedPrompt.length })}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative rounded-xl border-2 transition-all flex flex-col ${
        selected ? 'border-sky-400 shadow-2xl shadow-sky-500/20' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: size.w,
        height: size.h, // undefined → auto, 跟随内容自然高; 拖角后变成具体 px
        minWidth: 220,
      }}
    >
      {/* 四角自由缩放 (仅选中时出现) — 主题色用 sky-400 */}
      <ResizableCorners
        selected={selected}
        minWidth={220}
        minHeight={140}
        accent="#38bdf8"
        keepAspectRatio={resizeBehavior.keepAspectRatio}
        onResize={handleResize}
        onResizeEnd={() => syncNodeInternals()}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-sky-400 !border-0"
        style={{
          top: '50%',
          left: -5,
          width: 10,
          height: 10,
          minWidth: 10,
          minHeight: 10,
          transform: 'translateY(-50%)',
          zIndex: 12,
          pointerEvents: 'all',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-sky-400 !border-0"
        style={{
          top: '50%',
          right: -5,
          width: 10,
          height: 10,
          minWidth: 10,
          minHeight: 10,
          transform: 'translateY(-50%)',
          zIndex: 12,
          pointerEvents: 'all',
        }}
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(14,165,233,.18)', color: '#7dd3fc', boxShadow: 'inset 0 0 0 1px rgba(14,165,233,.4)' }}
        >
          <Type size={13} />
        </div>
        <div className="flex-1 text-sm font-semibold text-white">{t('text.title')}</div>
        <span className="text-[10px] text-white/30">prompt</span>
      </div>

      <div className={`p-2.5 flex flex-col ${size.h ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
        <MentionPromptInput
          title={t('text.promptTitle')}
          value={text}
          mentions={promptMentions}
          materials={mentionMaterials}
          onChange={(value, mentions) => update({
            prompt: value,
            text: value,
            promptMentions: mentions,
            promptResolved: resolveMediaMentions(value, mentions, mentionMaterials),
          })}
          placeholder={t('text.placeholder')}
          promptTemplateKind="image"
          isDark={isDark}
          isPixel={isPixel}
          toolbarAction={(
            <SmartTranslateButton
              text={text}
              nodeId={id}
              protectedTerms={translationProtectedTerms}
              lastRecord={d?.smartTranslation}
              onTranslated={handleTranslated}
              onRecord={handleTranslationRecord}
            />
          )}
          expandable
          fillHeight={!!size.h}
          className={`w-full resize-none rounded-md bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30 nodrag nowheel ${
            size.h ? 'min-h-0 flex-1' : 'h-24'
          }`}
        />
        <div className="text-[10px] text-white/30 mt-1 flex items-center gap-2 shrink-0">
          <span className="shrink-0" title={t('text.downstream')}>{t('text.characters', { count: resolvedPrompt.length })}{promptMentions.length ? ` · @${promptMentions.length}` : ''}</span>
          <label
            className="ml-auto flex items-center gap-1 nodrag nowheel"
            title={t('text.rhHint')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Hash size={9} />
            <input
              value={rhNodeIdRaw}
              onChange={(e) => handleRhNodeIdChange(e.target.value)}
              placeholder="RH#"
              inputMode="numeric"
              aria-label={t('text.rhSequence')}
              className="h-5 w-12 rounded border border-white/10 bg-white/5 px-1 text-[10px] text-white outline-none placeholder:text-white/20 focus:border-sky-300/60"
            />
            {rhNodeId && <span className="text-sky-200/70">#{rhNodeId}</span>}
          </label>
        </div>
      </div>
    </div>
  );
};

export default memo(TextNode);
