import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

test('video edit node is registered as a lightweight core video workflow node', () => {
  const types = read('src/types/canvas.ts');
  const placement = read('src/utils/nodePlacement.ts');
  const canvas = read('src/components/Canvas.tsx');
  const videoEdit = read('src/utils/videoEdit.ts');

  assert.match(types, /\|\s*'video-edit'/);
  assertProductionNodeSchema('video-edit', {
    label: '视频剪辑',
    category: 'core',
    inputs: ['video'],
    outputs: ['video', 'audio'],
    executable: false,
  });
  assert.match(placement, /'video-edit':\s*\{\s*w:\s*1120,\s*h:\s*680\s*\}/);
  assert.match(canvas, /const VideoEditNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/VideoEditNode'\), 'VideoEditNode'\)/);
  assert.match(canvas, /'video-edit':\s*VideoEditNode/);
  assert.match(canvas, /'video-edit':\s*\{\s*\.\.\.DEFAULT_VIDEO_EDIT_DATA[\s\S]*clips:\s*\[\]/);
  assert.match(videoEdit, /DEFAULT_VIDEO_EDIT_SETTINGS[\s\S]*aspect:\s*'first'[\s\S]*transition:\s*'none'[\s\S]*audio:\s*'keep'/);
});

test('send materials flow can append videos to a video edit node instead of creating output nodes', () => {
  const sendMaterials = read('src/utils/sendMaterials.ts');
  const modal = read('src/components/SendMaterialsModal.tsx');
  const canvas = read('src/components/Canvas.tsx');

  assert.match(sendMaterials, /\|\s*'video-edit'/);
  assert.match(modal, /value:\s*'video-edit'[\s\S]*label:\s*'视频剪辑'/);
  assert.match(modal, /视频剪辑节点/);
  assert.match(canvas, /appendMaterialsToVideoEditNode/);
  assert.match(canvas, /createVideoEditClipFromSendable/);
  assert.match(canvas, /selectVideoEditTargetNode/);
  assert.match(modal, /新建视频剪辑并发送/);
  assert.match(canvas, /跨画布视频剪辑/);
});

test('video edit separates reusable source assets from editable clip instances', () => {
  const videoEdit = read('src/utils/videoEdit.ts');

  assert.match(videoEdit, /assetId\?: string/);
  assert.match(videoEdit, /export function createVideoEditAssetId/);
  assert.match(videoEdit, /assetId:\s*typeof raw\.assetId === 'string' && raw\.assetId \? raw\.assetId : createVideoEditAssetId\(url, raw\.name\)/);
  assert.match(videoEdit, /createVideoEditClipFromMediaItem[\s\S]*assetId: extra\.assetId \|\| createVideoEditAssetId\(item\.url, item\.name\)/);
  assert.match(videoEdit, /replaceVideoEditClipAsset[\s\S]*assetId: extra\.assetId \|\| createVideoEditAssetId\(item\.url, item\.name\)/);
  assert.match(videoEdit, /appendVideoEditClips[\s\S]*seenIds/);
});

test('video edit backend exposes ffmpeg probe and compose endpoints', () => {
  const server = read('backend/src/server.js');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(server, /const videoOpsRouter = require\('\.\/routes\/videoOps'\)/);
  assert.match(server, /app\.use\('\/api\/video-ops', videoOpsRouter\)/);
  assert.match(route, /resolveBundledFfmpeg/);
  assert.match(route, /router\.post\('\/probe'/);
  assert.match(route, /router\.post\('\/compose'/);
  assert.match(route, /router\.get\('\/jobs\/:id'/);
  assert.match(route, /router\.post\('\/jobs\/:id\/cancel'/);
  assert.match(route, /video_edit_/);
  assert.match(route, /transition/);
  assert.match(route, /filter/);
  assert.match(route, /audio/);
});

test('video edit node offers creator presets, thumbnails, clip splitting, and async compose controls', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const service = read('src/services/videoOps.ts');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(videoEdit, /VideoEditAspect[\s\S]*'3:4'[\s\S]*'4:3'[\s\S]*'21:9'[\s\S]*'2:1'/);
  assert.doesNotMatch(videoEdit, /'4:5'/);
  assert.match(videoEdit, /VIDEO_EDIT_OUTPUT_PRESETS[\s\S]*抖音\/快手[\s\S]*B站\/YouTube[\s\S]*竖版海报[\s\S]*横版展示[\s\S]*电影宽屏[\s\S]*宽幅\/全景/);
  assert.match(videoEdit, /VIDEO_EDIT_CREATOR_TEMPLATES[\s\S]*快速混剪[\s\S]*口播混剪[\s\S]*产品展示[\s\S]*前后对比/);
  assert.match(videoEdit, /applyVideoEditOutputPreset/);
  assert.match(videoEdit, /applyVideoEditCreatorTemplate/);

  assert.match(node, /thumbnailUrl/);
  assert.match(node, /拆分片段/);
  assert.match(node, /splitSelectedClip/);
  assert.match(node, /data-video-edit-option-list="presets"/);
  assert.match(node, /剪辑方案/);
  assert.match(node, /取消合成/);
  assert.match(node, /composeVideoEditAsync/);
  assert.match(node, /getVideoEditJob/);
  assert.match(node, /cancelVideoEditJob/);

  assert.match(service, /composeVideoEditAsync/);
  assert.match(service, /async:\s*true/);
  assert.match(route, /req\.body\?\.async/);
  assert.match(route, /setImmediate/);
});

test('video edit creator schemes show concrete change summaries instead of vague templates', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /changes:\s*\[[\s\S]*转场[\s\S]*滤镜[\s\S]*音频/);
  assert.match(node, /selectedCreatorTemplate/);
  assert.match(node, /data-video-edit-scheme-list="true"/);
  assert.match(node, /data-video-edit-scheme-change="true"/);
  assert.match(node, /方案会修改/);
  assert.match(node, /item\.changes\.join/);
  assert.match(node, /selectedCreatorTemplate\?\.changes/);
  assert.match(node, /data-video-edit-workbench-list-row="schemes"/);
  assert.doesNotMatch(node, /剪辑方案（一键模板）/);
});

test('video edit transitions use the shared high-quality catalog instead of a small hard-coded list', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const route = read('backend/src/routes/videoOps.js');
  const packageJson = read('package.json');
  const postBuild = read('electron/_post_build.cjs');

  assert.match(videoEdit, /videoTransitions\.json/);
  assert.match(videoEdit, /VIDEO_EDIT_TRANSITIONS/);
  assert.match(videoEdit, /VIDEO_EDIT_TRANSITION_GROUPS/);
  assert.match(node, /VIDEO_EDIT_TRANSITION_GROUPS/);
  assert.match(node, /optgroup/);
  assert.doesNotMatch(node, /const TRANSITION_OPTIONS:[\s\S]*淡入淡出[\s\S]*简单滑入/);

  assert.match(route, /videoTransitions\.json/);
  assert.match(route, /getTransitionDefinition/);
  assert.match(route, /hasNativeXfadeSupport/);
  assert.match(route, /xfade=transition=/);
  assert.match(route, /acrossfade/);

  assert.match(packageJson, /tools\/ffmpeg-runtime[\s\S]*ffmpeg\.exe/);
  assert.match(postBuild, /checkFfmpegRuntime[\s\S]*xfade/);
});

test('video edit upload and upstream import controls remain interactive inside the canvas', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const openVideoFilePicker =/);
  assert.match(node, /const stopNodePointer =/);
  assert.match(node, /const handleEmptyPreviewActivate =/);
  assert.match(node, /getMediaItemsFromData\(nodeData,\s*'video'\)/);
  assert.match(node, /rf\.getEdges\(\)\.filter\(\(edge\) => edge\.target === id\)/);

  assert.match(node, /title="上传视频"[\s\S]*type="button"[\s\S]*nodrag nopan[\s\S]*onPointerDown=\{stopNodePointer\}[\s\S]*onClick=\{openVideoFilePicker\}/);
  assert.match(node, /title="导入上游视频"[\s\S]*type="button"[\s\S]*nodrag nopan[\s\S]*onPointerDown=\{stopNodePointer\}/);
  assert.match(node, /role="button"[\s\S]*上传或导入视频/);
  assert.match(node, /className="hidden nodrag nopan"/);

  assert.match(node, /probeAndPatchClip\(clip\.id,\s*clip\.url,\s*merged\)/);
  assert.doesNotMatch(node, /normalizeVideoEditClips\(\(data as any\)\?\.clips\)\.map/);
});

test('video edit timeline keeps duplicate source clips and links trim controls to preview', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /const seenIds = new Set<string>\(\)/);
  assert.doesNotMatch(videoEdit, /seen\.has\(url\)/);
  assert.doesNotMatch(videoEdit, /new Set\(base\.map\(\(clip\) => clip\.url\)\)/);
  assert.match(videoEdit, /next\.push\(\{ \.\.\.clip, id \}\)/);

  assert.match(node, /const previewVideoRef = useRef<HTMLVideoElement>\(null\)/);
  assert.match(node, /const seekPreviewTo =/);
  assert.match(node, /onTimeUpdate=\{handlePreviewTimeUpdate\}/);
  assert.match(node, /onPlay=\{playSelectedClipPreview\}/);
  assert.match(node, /跳入点/);
  assert.match(node, /跳出点/);
  assert.match(node, /打开剪辑台/);
  assert.match(node, /createPortal/);
  assert.match(node, /resize overflow-hidden/);
});

test('video edit node temporarily hides the full workbench entry button', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED = false/);
  assert.match(
    node,
    /\{VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && \([\s\S]{0,900}data-video-edit-open-workbench="true"[\s\S]{0,900}打开剪辑台[\s\S]{0,900}\)\}/,
  );
  assert.match(
    node,
    /VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && clips\.length > compactTimelineClips\.length[\s\S]{0,500}查看全部 \{clips\.length\} 段/,
  );
  assert.match(
    node,
    /\{VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && \([\s\S]{0,700}data-video-edit-node-detail-gate="true"[\s\S]{0,700}剪辑台细调[\s\S]{0,700}\)\}/,
  );
});

test('video edit preview resolves the current clip from timeline playback state', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /resolveVideoEditTimelinePlayback/);
  assert.match(videoEdit, /videoEditTimelineTimeFromPlaybackSourceTime/);
  assert.match(videoEdit, /export function buildVideoEditTimelinePreviewClip/);
  assert.match(node, /timelinePlayback = useMemo\(\(\) => resolveVideoEditTimelinePlayback/);
  assert.match(node, /buildVideoEditTimelinePreviewClip\(timelinePlayback/);
  assert.match(node, /const timelinePreviewIsEmptyGap = timelineHasVideoItems && !timelinePlayback\.item/);
  assert.match(node, /const baseSelectedClip = timelinePreviewClip \|\| \(timelineHasVideoItems && !timelinePlayback\.item \? null : selectedLegacyClip\)/);
  assert.match(node, /const previewOverrideMatchesTimeline = !timelinePreviewIsEmptyGap && !!previewOverride/);
  assert.match(node, /previewOverride\.timelineItemId === selectedTimelineItemId/);
  assert.match(node, /const selectedClip = timelinePreviewIsEmptyGap \? null : \(previewOverrideMatchesTimeline \? previewOverride\.clip : baseSelectedClip\)/);
  assert.match(node, /const activeTimelineItemId = previewOverrideMatchesTimeline/);
  assert.match(node, /timelinePlayback\.sourceTime/);
  assert.match(node, /const commitTimelinePlayhead =/);
  assert.match(node, /videoEditTimelineTimeFromPlaybackSourceTime\(timelinePlayback,\s*video\.currentTime\)/);
  assert.match(node, /data-video-edit-preview-mode="timeline-playhead"/);
  assert.match(node, /data-video-edit-preview-source-item-id=\{timelinePlayback\.item\?\.id \|\| ''\}/);
  assert.match(node, /data-video-edit-preview-source-time=\{timelinePlayback\.sourceTime\}/);
  assert.match(node, /当前预览：时间线播放头/);
  assert.doesNotMatch(node, /当前预览：单片段/);
  assert.match(node, /timelineV2:\s*\{\s*\.\.\.timelineV2,[^}]*playhead/);
  assert.match(node, /const selectTimelineVideoItem =/);
  assert.match(node, /onClick=\{\(event\) => \{ if \(shouldSuppressTimelineItemClick\(event\)\) return; selectTimelineVideoItem\(item, resolveWorkbenchTimelineSelectionMode\(event\)\); \}\}/);
  assert.match(node, /const findNextWorkbenchTimelineVideoItemAfter =/);
  assert.match(node, /pendingPreviewAutoplayRef\.current = true/);
  assert.match(node, /seekWorkbenchTimelineTo\(nextItem\.timelineStart\)/);
  assert.match(videoEdit, /timelineItemId\?: string/);
  assert.match(videoEdit, /sourceClipId\?: string/);
  assert.match(videoEdit, /timelineItemId:\s*item\.id/);
  assert.match(videoEdit, /sourceClipId:\s*source\?\.id/);
  assert.match(node, /activeTimelineItemId === item\.id/);
  assert.match(node, /data-video-edit-timeline-item-selected=\{timelineItemActive \? 'true' : undefined\}/);
  assert.doesNotMatch(node, /onClick=\{\(\) => update\(\{ selectedClipId: item\.id \}\)\}/);
  assert.match(node, /handleWorkbenchClipCardKeyDown\(event, item\.id\)/);
  assert.doesNotMatch(node, /data-video-edit-timeline-item-id=\{item\.id\}[\s\S]{0,700}onClick=\{\(\) => update\(\{ selectedClipId: clip\.id \}\)\}/);
  assert.doesNotMatch(node, /const selectedClip = clips\.find\(\(clip\) => clip\.id === d\.selectedClipId\) \|\| clips\[0\] \|\| null/);
});

test('full video edit workbench exposes draggable playhead and clickable ruler seek', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /videoEditTimelineTimeToX/);
  assert.match(videoEdit, /videoEditTimelineXToTime/);
  assert.match(node, /videoEditTimelineTimeToX/);
  assert.match(node, /videoEditTimelineXToTime/);
  assert.match(node, /const workbenchTimelineViewportRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(node, /const workbenchPlayheadDragCleanupRef = useRef<\(\(\) => void\) \| null>\(null\)/);
  assert.match(node, /const seekWorkbenchTimelineTo =/);
  assert.match(node, /const beginWorkbenchPlayheadDrag =/);
  assert.match(node, /const handleWorkbenchTimelineSeek =/);
  assert.match(node, /\[\s*workbenchTimelineViewportRef\.current,\s*workbenchOverlayTimelineViewportRef\.current,\s*workbenchAudioTimelineViewportRef\.current,\s*workbenchTextTimelineViewportRef\.current,\s*\]\.includes\(viewport as HTMLDivElement\)/);
  assert.match(node, /isTimelineViewport\s*\?\s*\(viewport\.scrollWidth \|\| rect\.width\)\s*:\s*rect\.width/);
  assert.match(node, /isTimelineViewport\s*\?\s*viewport\.scrollLeft\s*:\s*0/);
  assert.match(node, /data-video-edit-workbench-playhead="true"/);
  assert.match(node, /data-video-edit-workbench-playhead-line="true"/);
  assert.match(node, /data-video-edit-workbench-playhead-handle="true"/);
  assert.match(node, /data-video-edit-workbench-ruler-click="true"/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => handleWorkbenchTimelineSeek\(event\)\}/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginWorkbenchPlayheadDrag\(event\)\}/);
  assert.match(node, /setPreviewOverride\(\{\s*clip: nextPreviewClip/);
  assert.match(node, /timelineTime < end \|\| \(timelineTime === duration && timelineTime === end\)/);
  assert.match(node, /commitTimelinePlayhead\(nextTime,\s*playback\.item\?\.id\)/);
  assert.match(node, /seekPreviewTo\(playback\.sourceTime,\s*makePreviewClipKey\(nextPreviewClip\)\)/);
});

test('video edit preview keeps timeline seek requests through video metadata reloads', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const pendingPreviewSeekRef = useRef<\{ clipKey: string; seconds: number \} \| null>\(null\)/);
  assert.match(node, /const previewSeekGuardRef = useRef<\{ clipKey: string; seconds: number; expiresAt: number \} \| null>\(null\)/);
  assert.match(node, /const \[previewOverride, setPreviewOverride\] = useState/);
  assert.match(node, /const previewClipKey =/);
  assert.match(node, /const makePreviewClipKey =/);
  assert.match(node, /const applyPreviewSeek =/);
  assert.match(node, /const flushPendingPreviewSeek =/);
  assert.match(node, /previewOverrideMatchesTimeline/);
  assert.match(node, /if \(!previewOverrideMatchesTimeline\) \{\s*setPreviewOverride\(null\);/);
  assert.match(node, /basePreviewClipKey !== previewOverride\.clipKey/);
  assert.match(node, /setPreviewOverride\(null\)/);
  assert.match(node, /const targetClipKey = clipKey \|\| previewClipKey/);
  assert.match(node, /pendingPreviewSeekRef\.current = \{ clipKey: targetClipKey, seconds: next \}/);
  assert.match(node, /previewSeekGuardRef\.current = \{ clipKey: targetClipKey, seconds: next, expiresAt: Date\.now\(\) \+ 1200 \}/);
  assert.match(node, /const seekGuard = previewSeekGuardRef\.current/);
  assert.match(node, /Math\.abs\(video\.currentTime - seekGuard\.seconds\) > 0\.25/);
  assert.match(node, /applyPreviewSeek\(video, seekGuard\.seconds\)/);
  assert.match(node, /const nextPreviewClip = buildVideoEditTimelinePreviewClip\(playback, clips\)/);
  assert.match(node, /seekPreviewTo\(playback\.sourceTime, makePreviewClipKey\(nextPreviewClip\)\)/);
  assert.match(node, /if \(pending && pending\.clipKey !== previewClipKey\) return/);
  assert.match(node, /useEffect\(\(\) => \{\s*const pending = pendingPreviewSeekRef\.current/);
  assert.match(node, /window\.setTimeout\(flushPendingPreviewSeek, 0\)/);
  assert.match(node, /const handlePreviewLoadedMetadata = \(event: SyntheticEvent<HTMLVideoElement>\) => \{[\s\S]*flushPendingPreviewSeek\(\);/);
  assert.match(node, /onLoadedMetadata=\{handlePreviewLoadedMetadata\}/);
  assert.doesNotMatch(node, /onLoadedMetadata=\{\(\) => seekPreviewTo\(selectedClip\.trimStart \|\| 0\)\}/);
});

test('video edit node exposes real audio separation outputs', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const service = read('src/services/videoOps.ts');
  const route = read('backend/src/routes/videoOps.js');
  const videoEdit = read('src/utils/videoEdit.ts');

  assert.match(videoEdit, /hasAudio\?: boolean/);
  assert.match(videoEdit, /audioUrl\?: string/);
  assert.match(service, /separateVideoAudioAsync/);
  assert.match(node, /handleSeparateAudio/);
  assert.match(node, /无声视频/);
  assert.match(node, /提取音频/);
  assert.match(node, /无声\+音频/);
  assert.match(node, /directAudioUrls/);
  assert.match(route, /router\.post\('\/separate-audio'/);
  assert.match(route, /muteVideoFile/);
  assert.match(route, /extractAudioFile/);
  assert.match(route, /'-an'/);
});

test('video edit timeline exposes clip health lights and duration-based zoom', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /VideoEditClipHealthLevel = 'ok' \| 'warn' \| 'block'/);
  assert.match(videoEdit, /videoEditClipHealth/);
  assert.match(videoEdit, /videoEditTimelineHealthSummary/);
  assert.match(videoEdit, /videoEditTimelineWidth/);
  assert.match(videoEdit, /片段短于当前转场时长/);
  assert.match(node, /const \[timelineZoom, setTimelineZoom\]/);
  assert.match(node, /healthDotClass/);
  assert.match(node, /videoEditClipHealth\(clip, settings\)/);
  assert.match(node, /timelineHealth\.blocks === 0/);
  assert.match(node, /体检：\{timelineHealth\.label\}/);
  assert.match(node, /videoEditTimelineWidth\(clip, timelineZoom\)/);
  assert.match(node, /\[1, 2, 4\]\.map/);
  assert.match(node, /compactTimelineClips/);
  assert.match(node, /查看全部 \{clips\.length\} 段/);
});

test('video edit compose is blocked when timeline v2 has overlapping conflicts', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const hasTimelineV2Conflicts = timelineV2Conflicts\.length > 0/);
  assert.match(node, /const composeStatusLabel = canCompose \? '可合成' : composeBlockedReason/);
  assert.match(node, /const canCompose = timelineComposeClips\.length > 0 && timelineHealth\.blocks === 0 && !hasTimelineV2Conflicts && renderPlanUnsupported\.length === 0 && !running && !busy/);
  assert.match(node, /hasTimelineV2Conflicts \? '先处理冲突' :/);
  assert.match(node, /data-video-edit-timeline-v2-conflicts=\{timelineV2Conflicts\.length\}/);
  assert.match(node, /const composeBlockedMessage = useMemo\(\(\) => \{/);
  assert.match(node, /hasTimelineV2Conflicts[\s\S]{0,160}请先处理时间线重叠冲突/);
  assert.match(node, /timelineHealth\.blocks > 0[\s\S]{0,180}请先修复体检异常/);
  assert.match(node, /!timelineComposeClips\.length[\s\S]{0,160}请先导入或添加至少一段视频素材/);
  assert.match(node, /data-video-edit-workbench-compose-blocked="true"/);
  assert.match(node, /data-video-edit-workbench-compose-blocked-message=\{composeBlockedMessage\}/);
  assert.match(node, /handleCompose[\s\S]{0,260}if \(composeBlockedMessage\) \{[\s\S]{0,160}setLocalError\(composeBlockedMessage\)/);
  assert.match(node, /handleBatchPlatformExport[\s\S]{0,220}if \(composeBlockedMessage\) \{[\s\S]{0,160}setLocalError\(composeBlockedMessage\)/);
});

test('video edit workbench surfaces failed and cancelled job notices inside the output panel', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const workbenchJobNotice = useMemo\(\(\) => \{/);
  assert.match(node, /workbenchJobStatus === 'failed'/);
  assert.match(node, /workbenchJobStatus === 'cancelled'/);
  assert.match(node, /localError \|\| String\(d\.error \|\| ''\) \|\| String\(d\.job\?\.message \|\| ''\)/);
  assert.match(node, /data-video-edit-workbench-job-notice="true"/);
  assert.match(node, /data-video-edit-workbench-job-notice-status=\{workbenchJobNotice\.status\}/);
  assert.match(node, /data-video-edit-workbench-job-notice-tone=\{workbenchJobNotice\.tone\}/);
  assert.match(node, /data-video-edit-workbench-job-notice-message=\{workbenchJobNotice\.message\}/);
  assert.match(node, /role="status"[\s\S]{0,120}aria-live="polite"/);
});

test('video edit creator workflow tracks target duration, source lineage, and output versions', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /targetDuration\?: number/);
  assert.match(videoEdit, /VideoEditOutputVersion/);
  assert.match(videoEdit, /outputVersions\?: VideoEditOutputVersion\[\]/);
  assert.match(videoEdit, /sourceCanvasName\?: string/);
  assert.match(videoEdit, /sourceNodeLabel\?: string/);
  assert.match(videoEdit, /sourceCreatedAt\?: string/);
  assert.match(videoEdit, /videoEditDurationBudget/);
  assert.match(videoEdit, /compressVideoEditClipsToTargetDuration/);
  assert.match(videoEdit, /pushVideoEditOutputVersion/);

  assert.match(node, /目标时长/);
  assert.match(node, /压缩/);
  assert.match(node, /videoEditDurationBudget\(timelineComposeClips, settings\)/);
  assert.match(node, /compressVideoEditClipsToTargetDuration/);
  assert.match(node, /来源：\$\{clip\.sourceNodeLabel/);
  assert.match(node, /源节点/);
  assert.match(node, /copySourceInfo/);
  assert.match(node, /locateSourceClip/);
  assert.match(node, /copySourceInfo/);
  assert.match(node, /outputVersions/);
  assert.match(node, /normalizeVideoEditOutputVersions/);
  assert.match(node, /pushVideoEditOutputVersion/);
  assert.match(node, /addOutputNodeFromVersion/);
});

test('video edit output versions expose high-quality transition metadata', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const service = read('src/services/videoOps.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(service, /transitionEngine\?: 'concat' \| 'ffmpeg-xfade' \| 'timeline-layer' \| 'timeline-layer-xfade'/);
  assert.match(videoEdit, /transitionEngine\?: string/);
  assert.match(videoEdit, /transitionName\?: string/);
  assert.match(videoEdit, /transitionQuality\?: string/);
  assert.match(videoEdit, /transitionDuration\?: number/);
  assert.match(service, /timelineVideoTransitionApplied\?: boolean/);
  assert.match(videoEdit, /transitionEngine:\s*output\.transitionEngine/);
  assert.match(node, /transitionEngine:\s*result\.transitionEngine/);
  assert.match(node, /transitionEngine:\s*result\.transitionEngine/);
  assert.match(service, /ffmpeg-xfade/);
});

test('video edit target duration tools can evenly distribute clips before composing', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /distributeVideoEditClipsToTargetDuration/);
  assert.match(videoEdit, /targetDuration \/ clips\.length/);
  assert.match(node, /均分/);
  assert.match(node, /distributeVideoEditClipsToTargetDuration\(clips, settings\.targetDuration/);
});

test('video edit workbench trim controls reuse preview-seeking handlers', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const handleTrimStartChange =/);
  assert.match(node, /const handleTrimEndChange =/);
  assert.match(node, /handleTrimStartChange\(selectedClip\.id, Number\(event\.target\.value\)\)/);
  assert.match(node, /handleTrimEndChange\(selectedClip\.id, Number\(event\.target\.value\)\)/);
  assert.equal((node.match(/handleTrimStartChange\(selectedClip\.id, Number\(event\.target\.value\)\)/g) || []).length, 2);
  assert.equal((node.match(/handleTrimEndChange\(selectedClip\.id, Number\(event\.target\.value\)\)/g) || []).length, 2);
});

test('video edit preview playhead can split the selected clip at the current frame', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const \[previewTime, setPreviewTime\]/);
  assert.match(node, /setPreviewTime\(next\)/);
  assert.match(node, /splitSelectedClipAtPlayhead/);
  assert.match(node, /previewVideoRef\.current\?\.currentTime/);
  assert.match(node, /在播放头拆分/);
  assert.ok((node.match(/播放头拆分/g) || []).length >= 2);
});

test('video edit import cleanup can sort clips and trim every clip to the first seconds', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /defaultClipDuration\?: number/);
  assert.match(videoEdit, /sortVideoEditClipsByName/);
  assert.match(videoEdit, /trimVideoEditClipsToFirstSeconds/);
  assert.match(node, /排序/);
  assert.match(node, /trimClipsToDefaultDuration/);
  assert.match(node, /sortVideoEditClipsByName\(clips\)/);
  assert.match(node, /trimVideoEditClipsToFirstSeconds\(clips, settings\.defaultClipDuration/);
});

test('video edit import cleanup supports previewed full rules before applying', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /VideoEditImportSortMode = 'current' \| 'name' \| 'source' \| 'duration-asc' \| 'duration-desc'/);
  assert.match(videoEdit, /VideoEditDefaultTrimMode = 'full' \| 'first' \| 'middle'/);
  assert.match(videoEdit, /VideoEditAudioFilter = 'all' \| 'with-audio' \| 'without-audio'/);
  assert.match(videoEdit, /applyVideoEditImportCleanup/);
  assert.match(videoEdit, /trimVideoEditClipsToMiddleSeconds/);
  assert.match(videoEdit, /sourceNodeLabel/);
  assert.match(videoEdit, /hasAudio === true/);
  assert.match(videoEdit, /hasAudio === false/);

  assert.match(node, /importCleanupUndoRef/);
  assert.match(node, /importCleanupPreview/);
  assert.match(node, /previewImportCleanup/);
  assert.match(node, /applyImportCleanup/);
  assert.match(node, /undoImportCleanup/);
  assert.match(node, /buildImportCleanupOptions/);
  assert.match(node, /sortMode:\s*settings\.importSortMode/);
  assert.match(node, /trimMode:\s*settings\.defaultTrimMode/);
  assert.match(node, /audioFilter:\s*settings\.audioFilter/);
  assert.match(node, /previewImportCleanup/);
  assert.match(node, /applyImportCleanup/);
  assert.match(node, /undoImportCleanup/);
  assert.match(node, /applyVideoEditImportCleanup\(clips/);
});

test('video edit can batch export multiple platform packages from one timeline', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /VideoEditPlatformExportPackage/);
  assert.match(videoEdit, /VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES/);
  assert.match(videoEdit, /草稿小样/);
  assert.match(videoEdit, /applyVideoEditOutputPreset/);

  assert.match(node, /selectedPlatformPackageIds/);
  assert.match(node, /togglePlatformPackage/);
  assert.match(node, /handleBatchPlatformExport/);
  assert.match(node, /套餐/);
  assert.match(node, /输出与分离/);
  assert.match(node, /套餐队列/);
  assert.match(node, /actionId: 'video-edit\.platform-export'/);
  assert.match(node, /pendingVideoExecutionInputsRef\.current\.set\(action\.requestId, snapshot\)/);
  assert.match(node, /composeVideoEditAsync\(snapshot\.clips, operationSettings/);
  assert.match(node, /platformResults/);
  assert.match(node, /videoUrls:\s*downstream\.map/);
  assert.match(node, /directVideoUrls:\s*downstream\.map/);
  assert.match(node, /label:\s*`套餐 \$\{pkg\.label\}`/);
});

test('video edit platform draft exports do not replace final downstream video output', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /draftVideoUrls\?: string\[\]/);
  assert.match(videoEdit, /directDraftVideoUrls\?: string\[\]/);
  assert.match(videoEdit, /draftVideoUrls:\s*\[\]/);
  assert.match(videoEdit, /directDraftVideoUrls:\s*\[\]/);

  assert.match(node, /finalResults = platformResults\.filter\(\(item\) => item\.packageId !== 'draft-preview'\)/);
  assert.match(node, /finalResults\.length \? finalResults : platformResults/);
  assert.match(node, /draftVideoUrls:\s*platformResults\.filter\(\(item\) => item\.packageId === 'draft-preview'\)/);
  assert.match(node, /directDraftVideoUrls:\s*platformResults\.filter\(\(item\) => item\.packageId === 'draft-preview'\)/);
});

test('video edit recipes can be exported and imported without embedding media files', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /VideoEditRecipe/);
  assert.match(videoEdit, /t8-video-edit-recipe/);
  assert.match(videoEdit, /buildVideoEditRecipe/);
  assert.match(videoEdit, /normalizeVideoEditRecipe/);
  assert.match(videoEdit, /findVideoEditRecipeMissingAssets/);
  assert.match(videoEdit, /clips:\s*normalizeVideoEditClips/);
  assert.match(videoEdit, /timelineV2\?: VideoEditTimelineV2/);
  assert.match(videoEdit, /renderPlan\?: VideoEditTimelineRenderPlan/);
  assert.match(videoEdit, /timelineV2:\s*input\.timelineV2/);
  assert.match(videoEdit, /renderPlan:\s*input\.renderPlan/);
  assert.doesNotMatch(videoEdit, /base64/);

  assert.match(node, /recipeInputRef/);
  assert.match(node, /exportVideoEditRecipe/);
  assert.match(node, /importVideoEditRecipe/);
  assert.match(node, /buildVideoEditRecipe\(\{ clips, settings, timelineV2, renderPlan: timelineRenderPlan \}\)/);
  assert.match(node, /timelineV2:\s*recipe\.timelineV2/);
  assert.match(node, /\.t8-video-edit\.json/);
  assert.match(node, /配方卡/);
  assert.match(node, /导出配方/);
  assert.match(node, /导入配方/);
  assert.match(node, /缺素材/);
});

test('video edit can replace a clip asset without losing the clip instance trim', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /replaceVideoEditClipAsset/);
  assert.match(videoEdit, /previousTrimStart/);
  assert.match(videoEdit, /previousTrimEnd/);
  assert.match(videoEdit, /replacementSourceLabel/);
  assert.match(videoEdit, /status:\s*'probing'/);

  assert.match(node, /replacementInputRef/);
  assert.match(node, /replaceClipAsset/);
  assert.match(node, /openReplacementPicker/);
  assert.match(node, /替换素材/);
  assert.match(node, /替换素材/);
  assert.match(node, /保留剪辑点/);
  assert.match(node, /probeAndPatchClip\(nextClip\.id,\s*nextClip\.url/);
});

test('video edit keeps legacy safe-area settings but removes the safe-area reference UI', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /VideoEditSafeAreaOverlayId/);
  assert.match(videoEdit, /VIDEO_EDIT_SAFE_AREA_OVERLAYS/);
  assert.match(videoEdit, /safeAreaOverlay\?: VideoEditSafeAreaOverlayId/);
  assert.match(videoEdit, /safeAreaOverlay:\s*'none'/);

  assert.doesNotMatch(node, /SafeAreaOverlay/);
  assert.doesNotMatch(node, /preview-safe-area/);
  assert.doesNotMatch(node, /safeAreaOverlay/);
  assert.doesNotMatch(node, /发布安全区/);
  assert.doesNotMatch(node, /视频遮挡参考/);
  assert.doesNotMatch(node, /data-video-edit-safe-area-control="reference-only"/);
});

test('video edit workbench can switch to storyboard cards with notes and tags', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /storyboardNote\?: string/);
  assert.match(videoEdit, /storyboardTags\?: string\[\]/);
  assert.match(videoEdit, /storyboardTags:\s*Array\.isArray/);

  assert.match(node, /workbenchView/);
  assert.match(node, /故事板视图/);
  assert.match(node, /时间线视图/);
  assert.match(node, /handleStoryboardNoteChange/);
  assert.match(node, /handleStoryboardTagsChange/);
  assert.match(node, /moveStoryboardClip/);
  assert.match(node, /分镜备注/);
  assert.match(node, /镜头标签/);
  assert.match(node, /大卡片排序/);
});

test('video edit workbench has scoped keyboard micro controls without stealing canvas shortcuts', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /workbenchShellRef/);
  assert.match(node, /workbenchUndoStackRef/);
  assert.match(node, /workbenchRedoStackRef/);
  assert.match(node, /handleWorkbenchKeyDown/);
  assert.match(node, /isWorkbenchEditableTarget/);
  assert.match(node, /toggleWorkbenchPlayback/);
  assert.match(node, /setWorkbenchTrimFromPlayhead/);
  assert.match(node, /undoWorkbenchChange/);
  assert.match(node, /redoWorkbenchChange/);
  assert.match(node, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(node, /event\.key === ' '/);
  assert.match(node, /case 'i':/);
  assert.match(node, /case 'o':/);
  assert.match(node, /case 's':/);
  assert.match(node, /const claimWorkbenchShortcut = \(\) => \{/);
  assert.match(node, /claimWorkbenchShortcut[\s\S]{0,120}event\.preventDefault\(\);[\s\S]{0,120}event\.stopPropagation\(\);/);
  assert.match(node, /event\.key === 'Delete' \|\| event\.key === 'Backspace'[\s\S]{0,220}(claimBlockedWorkbenchEditingShortcut|claimWorkbenchShortcut)\(\);/);
  assert.match(node, /key === 'd'[\s\S]{0,220}(claimBlockedWorkbenchEditingShortcut|claimWorkbenchShortcut)\(\);/);
  assert.match(node, /Delete/);
  assert.match(node, /Ctrl\+Z/);
  assert.match(node, /Ctrl\+Y/);
  assert.match(node, /tabIndex=\{0\}/);
  assert.match(node, /onKeyDown=\{handleWorkbenchKeyDown\}/);
});

test('video edit workbench blocks editing shortcuts while busy or shortcut help is open', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const workbenchEditingShortcutBlocked = running \|\| !!busy \|\| workbenchShortcutsOpen/);
  assert.match(node, /const claimBlockedWorkbenchEditingShortcut = \(\) => \{/);
  assert.match(node, /workbenchShortcutsOpen[\s\S]{0,180}return true/);
  assert.match(node, /running \|\| busy[\s\S]{0,220}setLocalError\('当前正在处理，请稍后再使用剪辑台快捷键。'\)/);
  assert.match(node, /key === 'd'[\s\S]{0,180}if \(workbenchEditingShortcutBlocked\) \{[\s\S]{0,120}claimBlockedWorkbenchEditingShortcut\(\)/);
  assert.match(node, /event\.key === 'Delete' \|\| event\.key === 'Backspace'[\s\S]{0,180}if \(workbenchEditingShortcutBlocked\) \{[\s\S]{0,120}claimBlockedWorkbenchEditingShortcut\(\)/);
  assert.match(node, /case 's':[\s\S]{0,180}if \(workbenchEditingShortcutBlocked\) \{[\s\S]{0,120}claimBlockedWorkbenchEditingShortcut\(\)/);
});

test('video edit workbench exposes a discoverable shortcut system', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const VIDEO_EDIT_WORKBENCH_SHORTCUTS = \[/);
  assert.match(node, /id:\s*'play-toggle'/);
  assert.match(node, /id:\s*'split-playhead'/);
  assert.match(node, /id:\s*'duplicate-selected'/);
  assert.match(node, /id:\s*'delete-selected'/);
  assert.match(node, /id:\s*'undo'/);
  assert.match(node, /id:\s*'redo'/);
  assert.match(node, /id:\s*'shortcut-help'/);
  assert.match(node, /const \[workbenchShortcutsOpen, setWorkbenchShortcutsOpen\] = useState\(false\)/);
  assert.match(node, /const toggleWorkbenchShortcuts = \(\) =>/);
  assert.match(node, /event\.key === '\?' \|\| \(event\.key === '\/' && event\.shiftKey\)/);
  assert.match(node, /event\.key === 'Escape'[\s\S]{0,220}setWorkbenchShortcutsOpen\(false\)/);
  assert.match(node, /data-video-edit-workbench-action="show-shortcuts"/);
  assert.match(node, /data-video-edit-shortcuts-panel="true"/);
  assert.match(node, /data-video-edit-shortcut-row=\{shortcut\.id\}/);
  assert.match(node, /data-video-edit-shortcuts-close="true"/);
  assert.match(node, /isWorkbenchEditableTarget\(event\.target\)/);
  assert.match(node, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(node, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(node, /duplicateSelectedTimelineItems\(\)/);
  assert.match(node, /splitSelectedClipAtPlayhead\(\)/);
  assert.match(node, /undoWorkbenchChange\(\)/);
  assert.match(node, /redoWorkbenchChange\(\)/);
});

test('video edit can capture the current preview frame as cover, canvas image, target frame, or image edit input', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const service = read('src/services/videoOps.ts');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(videoEdit, /coverImageUrl\?: string/);
  assert.match(videoEdit, /coverFrameTime\?: number/);
  assert.match(service, /snapshotVideoFrameAsync/);
  assert.match(route, /router\.post\('\/snapshot'/);
  assert.match(route, /snapshotVideoFrame/);
  assert.match(route, /'-frames:v'/);

  assert.match(node, /snapshotVideoFrameAsync/);
  assert.match(node, /previewVideoRef\.current\?\.currentTime/);
  assert.match(node, /setImageEditSnapshotUrl/);
  assert.match(node, /ImageEditModal/);
  assert.match(node, /设为封面帧/);
  assert.match(node, /截图到输出素材/);
  assert.match(node, /截图到生成目标框/);
  assert.match(node, /截图到图像编辑/);
  assert.match(node, /buildCreativeTargetResult/);
  assert.match(node, /type:\s*'generation-target'/);
  assert.match(node, /type:\s*'output'/);
  assert.match(node, /imageUrl:\s*snapshot\.imageUrl/);
  assert.match(node, /directImageUrl:\s*snapshot\.directImageUrl/);
});

test('video edit exposes filmstrip frames and audio waveform previews for precise trimming', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const service = read('src/services/videoOps.ts');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(videoEdit, /filmstripUrls\?: string\[\]/);
  assert.match(videoEdit, /filmstripTimes\?: number\[\]/);
  assert.match(videoEdit, /waveformPeaks\?: number\[\]/);
  assert.match(videoEdit, /timelinePreviewStatus\?: 'idle' \| 'loading' \| 'ready' \| 'error'/);

  assert.match(service, /loadVideoTimelinePreviewAsync/);
  assert.match(service, /VideoTimelinePreviewResult/);
  assert.match(route, /router\.post\('\/timeline-preview'/);
  assert.match(route, /createTimelinePreview/);

  assert.match(node, /loadClipTimelinePreview/);
  assert.match(node, /FilmstripPreview/);
  assert.match(node, /WaveformPreview/);
  assert.match(node, /帧条/);
  assert.match(node, /音频波形/);
});

test('video edit workbench windows large clip lists for 30 50 80 clip performance', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /VIDEO_EDIT_COMPACT_TIMELINE_LIMIT\s*=\s*8/);
  assert.match(node, /VIDEO_EDIT_WORKBENCH_WINDOW_SIZE\s*=\s*24/);
  assert.match(node, /workbenchClipWindowStart/);
  assert.match(node, /workbenchVisibleClips/);
  assert.match(node, /workbenchWindowLabel/);
  assert.match(node, /workbenchFilteredClips/);
  assert.match(node, /workbenchClipSourceFilter/);
  assert.match(node, /Math\.min\(workbenchFilteredClips\.length,\s*workbenchClipWindowStart \+ VIDEO_EDIT_WORKBENCH_WINDOW_SIZE\)/);
  assert.match(node, /setWorkbenchClipWindowStart\(nextStart\)/);
  assert.match(node, /上一组/);
  assert.match(node, /下一组/);
  assert.match(node, /查看全部 \{clips\.length\} 段/);

  assert.doesNotMatch(node, /\{clips\.map\(\(clip, index\) => \{/);
  assert.match(node, /\{workbenchVisibleClips\.map\(\(clip, visibleIndex\) => \{/);
});

test('video edit workbench timeline paging is independent from media-bin paging', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /workbenchTimelineWindowStart/);
  assert.match(node, /setWorkbenchTimelineWindowStart/);
  assert.match(node, /moveWorkbenchTimelineWindow/);
  assert.match(node, /workbenchMainTimelineItems\.slice\(workbenchTimelineWindowStart,\s*workbenchTimelineWindowEnd\)/);
  assert.match(node, /data-video-edit-workbench-timeline-window-label="true"/);
  assert.match(node, /workbenchTimelineWindowEnd >= workbenchMainTimelineItems\.length/);
  assert.doesNotMatch(
    node,
    /workbenchMainTimelineItems\.slice\(workbenchClipWindowStart,\s*workbenchTimelineWindowEnd\)/,
  );
  assert.doesNotMatch(
    node,
    /data-video-edit-workbench-primary-scroll="true"[\s\S]{0,2200}moveWorkbenchWindow/,
  );
});

test('video edit workbench timeline supports direct edge trimming on clip cards', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /type VideoEditTimelineTrimDrag/);
  assert.match(node, /timelineItemId\?: string/);
  assert.match(node, /timelineTrimDragRef/);
  assert.match(node, /const startTimelineTrimDrag =/);
  assert.match(node, /const beginTimelineTrimDrag =/);
  assert.match(node, /const beginTimelineTrimMouseDrag =/);
  assert.match(node, /const continueOrStartTimelineTrimTrackDrag =/);
  assert.match(node, /const continueOrStartTimelineTrimTrackMouseDrag =/);
  assert.match(node, /event\.buttons !== 1/);
  assert.match(node, /const handleTimelineTrimPointerMove =/);
  assert.match(node, /const applyTimelineTrimClientX =/);
  assert.match(node, /const handleTimelineTrimWindowPointerMove =/);
  assert.match(node, /const handleTimelineTrimWindowMouseMove =/);
  assert.match(node, /document\.addEventListener\('pointermove', handleTimelineTrimWindowPointerMove, \{ capture: true, passive: false \}\)/);
  assert.match(node, /document\.addEventListener\('mousemove', handleTimelineTrimWindowMouseMove, \{ capture: true, passive: false \}\)/);
  assert.match(node, /document\.removeEventListener\('pointermove', handleTimelineTrimWindowPointerMove, true\)/);
  assert.match(node, /document\.removeEventListener\('mousemove', handleTimelineTrimWindowMouseMove, true\)/);
  assert.match(node, /const finishTimelineTrimDrag =/);
  assert.match(node, /data-video-edit-timeline-card="true"/);
  assert.match(node, /data-video-edit-trim-track="true"/);
  assert.match(node, /data-video-edit-trim-handle="start"/);
  assert.match(node, /data-video-edit-trim-handle="end"/);
  assert.match(node, /const stopInteractivePointer =/);
  assert.match(node, /event\.nativeEvent\.stopImmediatePropagation\?\.\(\)/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginTimelineTrimDrag\(event, clip, 'start'/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginTimelineTrimDrag\(event, clip, 'end'/);
  assert.match(node, /onMouseDownCapture=\{\(event\) => beginTimelineTrimMouseDrag\(event, clip, 'start'/);
  assert.match(node, /onMouseDownCapture=\{\(event\) => beginTimelineTrimMouseDrag\(event, clip, 'end'/);
  assert.match(node, /className="nodrag nopan/);
  assert.match(node, /setPointerCapture/);
  assert.match(node, /releasePointerCapture/);
  assert.doesNotMatch(node, /const beginTimelineTrimDrag =[\s\S]*?update\(\{ selectedClipId: clip\.id \}\);[\s\S]*?try \{/);
  assert.match(node, /const patchClip = \(clipId: string, patch: Partial<VideoEditClip>, extra: Record<string, any> = \{\}\)/);
  assert.match(node, /patchClip\(clipId, \{ trimStart: value \}, \{ selectedClipId: clipId \}\)/);
  assert.match(node, /patchClip\(clipId, \{ trimEnd: value \}, \{ selectedClipId: clipId \}\)/);
  assert.match(node, /syncVideoEditClipsFromTimelineItem/);
  assert.match(node, /resizeVideoEditTimelineItem\(liveTimeline, drag\.timelineItemId, drag\.edge, nextSecond\)/);
  assert.match(node, /const nextClips = syncVideoEditClipsFromTimelineItem\(current, nextTimeline, drag\.timelineItemId, clipId\)/);
  assert.match(node, /update\(\{ clips: nextClips, timelineV2: nextTimeline, selectedClipId: clipId \}\)/);
  assert.match(node, /aria-label=\{`拖动调整片段 \$\{index \+ 1\} 入点`\}/);
  assert.match(node, /aria-label=\{`拖动调整片段 \$\{index \+ 1\} 出点`\}/);
});

test('video edit compact playlist timeline supports direct duration dragging with preview seeking', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-node-trim-track="compact"/);
  assert.match(node, /data-video-edit-node-trim-placement="below-preview"/);
  assert.match(node, /data-video-edit-node-timeline-card="true"/);
  assert.match(node, /data-video-edit-node-trim-range="true"/);
  assert.match(node, /data-video-edit-node-trim-handle="start"/);
  assert.match(node, /data-video-edit-node-trim-handle="end"/);
  assert.match(node, /function buildVideoEditTrimVisual/);
  assert.match(node, /function buildVideoEditTrimmedCardVisual/);
  assert.match(node, /const clipForTimeline = buildNodeTimelinePresentationClip\(clip, timelineItem\)/);
  assert.match(node, /const trimVisual = buildVideoEditTrimmedCardVisual\(clipForTimeline\)/);
  assert.match(node, /data-video-edit-trim-thumbnail-window="true"/);
  assert.match(node, /data-video-edit-trim-thumbnail-window-mode="trim-range-sync"/);
  assert.match(node, /data-video-edit-trim-thumbnail-active="true"/);
  assert.match(node, /data-video-edit-trim-thumbnail-mask="true"/);
  assert.match(node, /data-video-edit-trim-thumbnail-mask-mode="hidden-outside-trim"/);
  assert.match(node, /clipForTimeline\.url \? \(/);
  assert.match(node, /onLoadedMetadata=\{\(event\) => patchClipVideoElementMetadata\(clip\.id, event\.currentTarget\)\}/);
  assert.match(node, /const beginTimelineTrimTrackDrag =/);
  assert.match(node, /const beginTimelineTrimTrackMouseDrag =/);
  assert.match(node, /applyTimelineTrimClientX\(event\.clientX\)/);
  assert.match(node, /onPointerMove=\{handleTimelineTrimPointerMove\}/);
  assert.match(node, /onPointerUp=\{finishTimelineTrimDrag\}/);
  assert.match(node, /draggable=\{false\}/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimTrackDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\); \}\}/);
  assert.match(node, /onMouseDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimTrackMouseDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\); \}\}/);
  assert.match(node, /onPointerMoveCapture=\{\(event\) => continueOrStartTimelineTrimTrackDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\)\}/);
  assert.match(node, /onMouseMoveCapture=\{\(event\) => continueOrStartTimelineTrimTrackMouseDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\)\}/);
  assert.match(node, /selectNodeTimelineClip\(clip\); beginTimelineTrimDrag\(event, clipForTimeline, 'start', trimVisual\.trackElement, 'trimmed-window', timelineItem\?\.id\)/);
  assert.match(node, /selectNodeTimelineClip\(clip\); beginTimelineTrimDrag\(event, clipForTimeline, 'end', trimVisual\.trackElement, 'trimmed-window', timelineItem\?\.id\)/);
  assert.match(node, /selectNodeTimelineClip\(clip\); beginTimelineTrimMouseDrag\(event, clipForTimeline, 'start', trimVisual\.trackElement, 'trimmed-window', timelineItem\?\.id\)/);
  assert.match(node, /selectNodeTimelineClip\(clip\); beginTimelineTrimMouseDrag\(event, clipForTimeline, 'end', trimVisual\.trackElement, 'trimmed-window', timelineItem\?\.id\)/);
  assert.match(node, /const handleTrimStartChange = \(clipId: string, value: number\) => \{[\s\S]*seekPreviewTo\(value\)/);
  assert.match(node, /const handleTrimEndChange = \(clipId: string, value: number\) => \{[\s\S]*seekPreviewNearTrimEnd\(clipId, value\)/);
  assert.match(node, /handleTrimStartChange\(clipId, nextSecond\)/);
  assert.match(node, /handleTrimEndChange\(clipId, nextSecond\)/);
  assert.doesNotMatch(node, /data-video-edit-node-trim-track="compact"[\s\S]{0,220}className="absolute bottom-5/);
});

test('video edit compact playlist selection synchronizes the active timeline item', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const compactCardBlock = node.match(/data-video-edit-node-timeline-card="true"[\s\S]*?data-video-edit-node-trim-track="compact"[\s\S]*?data-video-edit-node-trim-handle="end"[\s\S]*?title="拖动调整出点并预览"/);

  assert.ok(compactCardBlock, 'compact playlist card block should exist');
  assert.match(node, /const findTimelineVideoItemForClip = \(clip: VideoEditClip\) =>/);
  assert.match(node, /const selectNodeTimelineClip = \(clip: VideoEditClip\) =>/);
  assert.match(node, /const timelineItem = findTimelineVideoItemForClip\(clip\)/);
  assert.match(node, /selectTimelineVideoItem\(timelineItem\)/);
  assert.match(node, /update\(\{ selectedClipId: clip\.id \}\)/);
  assert.match(compactCardBlock[0], /onClick=\{\(\) => selectNodeTimelineClip\(clip\)\}/);
  assert.match(compactCardBlock[0], /onPointerDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimTrackDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\); \}\}/);
  assert.match(compactCardBlock[0], /onMouseDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimTrackMouseDrag\(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem\?\.id\); \}\}/);
  assert.match(compactCardBlock[0], /onPointerDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimDrag\(event, clipForTimeline, 'start'/);
  assert.match(compactCardBlock[0], /onPointerDownCapture=\{\(event\) => \{ selectNodeTimelineClip\(clip\); beginTimelineTrimDrag\(event, clipForTimeline, 'end'/);
  assert.doesNotMatch(compactCardBlock[0], /onClick=\{\(\) => update\(\{ selectedClipId: clip\.id \}\)\}/);
});

test('video edit upstream import preserves probed media metadata for compact timeline cards', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const pushBlock = node.match(/const push = \(item: Partial<VideoImportCandidate>\) => \{[\s\S]*?out\.push\(\{[\s\S]*?\}\);\s*\};/);
  const importBlock = node.match(/const importUpstream = async \(\) => \{[\s\S]*?await appendClips\(incoming\);[\s\S]*?\};/);

  assert.ok(pushBlock, 'upstream push block should exist');
  assert.ok(importBlock, 'upstream import block should exist');
  assert.match(pushBlock[0], /duration: item\.duration/);
  assert.match(pushBlock[0], /width: item\.width/);
  assert.match(pushBlock[0], /height: item\.height/);
  assert.match(pushBlock[0], /thumbnailUrl: item\.thumbnailUrl/);
  assert.match(pushBlock[0], /hasAudio: item\.hasAudio/);
  assert.match(importBlock[0], /duration: item\.duration/);
  assert.match(importBlock[0], /width: item\.width/);
  assert.match(importBlock[0], /height: item\.height/);
  assert.match(importBlock[0], /thumbnailUrl: item\.thumbnailUrl/);
  assert.match(importBlock[0], /hasAudio: item\.hasAudio/);
  assert.match(node, /const duration = videoEditClipDuration\(clipForTimeline\)/);
  assert.match(node, /const measuredDuration = duration > 0\.25 \? duration : Number\(clip\.duration \|\| clip\.trimEnd \|\| 0\)/);
  assert.match(node, /const layoutDuration = Math\.max\(1, measuredDuration > 0\.25 \? measuredDuration : 5\)/);
  assert.match(node, /const trimVisual = buildVideoEditTrimmedCardVisual\(clipForTimeline\)/);
  assert.match(node, /clipForTimeline\.thumbnailUrl/);
  assert.match(node, /const patchClipVideoElementMetadata = \(clipId: string, video: HTMLVideoElement\) =>/);
  assert.match(node, /onLoadedMetadata=\{handlePreviewLoadedMetadata\}/);
});

test('video edit trimmed timeline cards do not leave source-duration blank space after trimming', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /type VideoEditTrimInteractionMode = 'source' \| 'trimmed-window'/);
  assert.match(node, /dragMinSecond: number/);
  assert.match(node, /dragMaxSecond: number/);
  assert.match(node, /trimmedWindowRangeStyle: CSSProperties/);
  assert.match(node, /trimmedWindowThumbnailStyle: CSSProperties/);
  assert.match(node, /trimmedWindowStartHandleStyle: CSSProperties/);
  assert.match(node, /trimmedWindowEndHandleStyle: CSSProperties/);
  assert.match(node, /trimmedWindowRangeStyle: \{ left: '0%', right: '0%' \}/);
  assert.match(node, /trimmedWindowThumbnailStyle: \{ left: '0%', right: '0%' \}/);
  assert.match(node, /activeThumbnailStyle: visual\.activeThumbnailStyle/);
  assert.doesNotMatch(node, /activeThumbnailStyle: \{ left: '0%', width: '100%' \}/);
  assert.match(node, /trimmedWindowEndHandleStyle: \{ left: '100%' \}/);
  assert.match(node, /function buildVideoEditTrimmedCardVisual/);
  assert.match(node, /buildVideoEditTrimmedCardVisual\(clip\)/);
  assert.match(node, /videoEditTimelineTimeToX\(item\.timelineStart,\s*\{[\s\S]*pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND/);
  assert.match(node, /const itemWidth = Math\.max\(\s*96,\s*Math\.round\(Math\.max\(0\.1,\s*item\.sourceOut - item\.sourceIn\)/);
  assert.match(node, /style=\{\{[\s\S]*left: itemLeft,[\s\S]*width: itemWidth,[\s\S]*minWidth: itemWidth/);
  assert.match(node, /const dragSpan = Math\.max\(0\.1, drag\.dragMaxSecond - drag\.dragMinSecond\)/);
  assert.match(node, /let nextSecond = Number\(\(drag\.dragMinSecond \+ ratio \* dragSpan\)\.toFixed\(2\)\)/);
  assert.match(node, /mode === 'trimmed-window' \? trimVisual\.trimmedWindowStartPct : trimVisual\.trimStartPct/);
  assert.match(node, /mode === 'trimmed-window' \? trimVisual\.trimmedWindowEndPct : trimVisual\.trimEndPct/);
  assert.match(node, /data-video-edit-trim-window-space="trimmed-card"/);
  assert.match(node, /style=\{trimVisual\.trimmedWindowThumbnailStyle\}/);
  assert.match(node, /style=\{trimVisual\.trimmedWindowRangeStyle\}/);
  assert.match(node, /style=\{trimVisual\.trimmedWindowStartHandleStyle\}/);
  assert.match(node, /style=\{trimVisual\.trimmedWindowEndHandleStyle\}/);
  assert.match(node, /beginTimelineTrimTrackDrag\(event, clip, trimVisual, 'trimmed-window'\)/);
  assert.match(node, /beginTimelineTrimDrag\(event, clip, 'end', trimVisual\.trackElement, 'trimmed-window'\)/);
});

test('video edit timeline cards expose per-clip mute and delete actions', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(node, /const toggleClipMuted = \(clipId: string\) => \{/);
  assert.match(node, /patchClip\(clipId, \{ muted: !target\.muted \}\)/);
  assert.match(node, /data-video-edit-clip-action="mute"/);
  assert.match(node, /data-video-edit-clip-action="delete"/);
  assert.match(node, /data-video-edit-clip-actions-placement="top-right"/);
  assert.match(node, /data-video-edit-clip-duration-placement="bottom-right"/);
  assert.match(node, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); toggleClipMuted\(clip\.id\); \}\}/);
  assert.match(node, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); removeClip\(clip\.id\); \}\}/);
  assert.match(route, /if \(clip\?\.muted \|\| !probe\?\.hasAudio\) return false/);
});

test('video edit output actions place nodes outside the wide editor and keep video/audio outputs explicit', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /import \{ placeSingleNode \} from '\.\.\/\.\.\/utils\/nodePlacement'/);
  assert.match(node, /const resolveVideoEditOutputNodePosition =/);
  assert.match(node, /placeSingleNode\(baseX, baseY, 'output', rf\.getNodes\(\), \{ source: `placement:video-edit-output:\$\{id\}` \}\)/);
  assert.match(node, /addOutputNodeFromVersion = \(version: VideoEditOutputVersion, mediaKind: 'video' \| 'audio' = 'video'\)/);
  assert.match(node, /const includeVideo = mediaKind !== 'audio' && !!version\.videoUrl/);
  assert.match(node, /const includeAudio = mediaKind !== 'video' && !!version\.audioUrl/);
  assert.match(node, /addOutputNodeFromVersion\(nextVersions\[0\], 'video'\)/);
  assert.match(node, /addOutputNodeFromVersion\(nextVersions\[0\], 'audio'\)/);
  assert.match(node, /addOutputNodeFromVersion\(outputVersions\[0\], 'video'\)/);
  assert.doesNotMatch(node, /x:\s*\(self\?\.position\.x \|\| 0\) \+ 820[\s\S]*y:\s*\(self\?\.position\.y \|\| 0\) \+ 220/);
});

test('video edit compose jobs are not treated as audio separation just because older result fields exist', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const isSeparateAudioResult = \(result: VideoComposeResult\) => result\.mode === 'audio-only' \|\| result\.mode === 'mute-video' \|\| result\.mode === 'both'/);
  assert.match(node, /if \(isSeparateAudioResult\(job\.result\)\) applySeparateResult\(job\.result\)/);
  assert.doesNotMatch(node, /if \(job\.result\.audioUrl \|\| job\.result\.mode\) applySeparateResult/);
});

test('video edit workbench surfaces render-plan capabilities and blocks unsupported exports', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const renderPlanUnsupported = useMemo\(\(\) => \{/);
  assert.doesNotMatch(node, /多轨\/PIP 合成暂不支持同时使用转场/);
  assert.match(node, /const unsupported = \[\.\.\.\(timelineRenderPlan\.unsupported \|\| \[\]\)\]/);
  assert.match(node, /const timelineCapabilities = timelineRenderPlan\.capabilities/);
  assert.match(node, /timelineCapabilities\.timelineLayerCompose/);
  assert.match(node, /timelineCapabilities\.timelineAudioMix/);
  assert.match(node, /timelineCapabilities\.subtitleBurnIn/);
  assert.match(node, /data-video-edit-workbench-capability-list="true"/);
  assert.match(node, /data-video-edit-workbench-capability=\{badge\.key\}/);
  assert.match(node, /data-video-edit-workbench-unsupported-list="true"/);
  assert.match(node, /当前剪辑台暂不支持导出/);
  assert.match(node, /renderPlanUnsupported\.length === 0/);
});

test('video edit workbench keeps preview clean and explains export contract in the inspector', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const previewContractItems = useMemo\(\(\) => \[/);
  assert.match(node, /timelineCapabilities\.timelineLayerCompose \? '最终导出：多轨合成' : '最终导出：顺序拼接'/);
  assert.match(node, /timelineCapabilities\.subtitleBurnIn \? '字幕会烧录' : '字幕未启用'/);
  assert.match(node, /data-video-edit-workbench-preview-clean="content-only"/);
  assert.match(node, /data-video-edit-workbench-preview-contract="right-panel"/);
  assert.match(node, /data-video-edit-workbench-preview-contract-location="inspector"/);
  assert.match(node, /data-video-edit-workbench-preview-contract-item=\{item\.key\}/);
  assert.match(node, /当前预览：时间线播放头/);
  assert.doesNotMatch(node, /<div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">/);
  assert.doesNotMatch(node, /最终导出按时间线生成/);
});

test('video edit full workbench keeps creator controls out of the playback screen', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  const commandRailStart = node.indexOf('data-video-edit-workbench-command-rail="true"');
  const layoutStart = node.indexOf('data-video-edit-workbench-layout="studio-timeline"');
  const previewStart = node.indexOf('data-video-edit-workbench-zone="preview-stage-center"', layoutStart);
  const timelineStart = node.indexOf('data-video-edit-workbench-zone="timeline-bottom"', layoutStart);

  assert.ok(commandRailStart >= 0, 'creator command rail should exist');
  assert.ok(layoutStart >= 0, 'studio workbench layout should exist');
  assert.ok(previewStart > layoutStart, 'preview stage should be inside the studio layout');
  assert.ok(timelineStart > previewStart, 'bottom multitrack timeline should follow the preview stage');
  assert.ok(commandRailStart < layoutStart, 'creator command rail belongs above the studio grid, not inside the preview');

  const toolbarRegion = node.slice(commandRailStart, layoutStart);
  const previewRegion = node.slice(previewStart, timelineStart);
  const timelineRegion = node.slice(timelineStart);

  assert.match(toolbarRegion, /data-video-edit-workbench-feature-audit="true"/);
  assert.doesNotMatch(previewRegion, /data-video-edit-workbench-command-rail="true"/);
  assert.doesNotMatch(previewRegion, /data-video-edit-workbench-feature-audit="true"/);
  assert.doesNotMatch(previewRegion, /data-video-edit-workbench-visible-feature-hub="true"/);
  assert.doesNotMatch(previewRegion, /data-video-edit-workbench-visible-feature-audit="true"/);
  assert.doesNotMatch(previewRegion, /workbenchCreatorCommandItems\.map/);
  assert.doesNotMatch(previewRegion, /workbenchFeatureAuditItems\.map/);
  assert.match(timelineRegion, /data-video-edit-workbench-visible-feature-hub="true"/);
  assert.match(timelineRegion, /data-video-edit-workbench-property-inspector-placement="timeline-detail"/);
});

test('video edit preview mirrors export filter settings and highlights transition zones', () => {
  const videoEdit = read('src/utils/videoEdit.ts');
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(videoEdit, /export function videoEditPreviewFilterCss/);
  assert.match(videoEdit, /brightness\(1\.08\) saturate\(1\.04\)/);
  assert.match(videoEdit, /contrast\(1\.18\) saturate\(1\.05\)/);
  assert.match(videoEdit, /grayscale\(1\)/);

  assert.match(node, /videoEditPreviewFilterCss/);
  assert.match(node, /const previewFilterCss = useMemo\(\(\) => videoEditPreviewFilterCss\(settings\.filter\)/);
  assert.match(node, /const previewVideoStyle = useMemo<CSSProperties>/);
  assert.match(node, /data-video-edit-preview-filter=\{settings\.filter\}/);
  assert.match(node, /data-video-edit-preview-filter-active=\{previewFilterCss \? 'true' : 'false'\}/);
  assert.match(node, /style=\{previewVideoStyle\}/);

  assert.match(node, /type VideoEditPreviewTransitionState =/);
  assert.match(node, /function VideoEditPreviewTransitionBadge/);
  assert.match(node, /data-video-edit-preview-transition="true"/);
  assert.match(node, /data-video-edit-preview-transition-edge=\{transition\.edge\}/);
  assert.match(node, /data-video-edit-preview-transition-id=\{transition\.transition\}/);
  assert.match(node, /data-video-edit-preview-transition-duration=\{transition\.duration\}/);
  assert.match(node, /const activePreviewTransition = useMemo<VideoEditPreviewTransitionState \| null>/);
  assert.match(node, /settings\.transitionDuration/);
  assert.match(node, /timelineRenderPlan\.clips[\s\S]*layerIndex === 0/);
  assert.match(node, /VideoEditPreviewTransitionBadge transition=\{activePreviewTransition\}/);
  assert.match(node, /进入转场/);
  assert.match(node, /离开转场/);
});

test('video edit workbench shows transition cut chips between adjacent main clips', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const workbenchTransitionCutItems = useMemo\(\(\) =>/);
  assert.match(node, /workbenchTimelineItems\.slice\(1\)\.map/);
  assert.match(node, /data-video-edit-transition-cut-chip="true"/);
  assert.match(node, /data-video-edit-transition-cut-index=\{cut\.index\}/);
  assert.match(node, /data-video-edit-transition-cut-transition=\{settings\.transition\}/);
  assert.match(node, /data-video-edit-transition-cut-duration=\{cut\.durationLabel\}/);
  assert.match(node, /data-video-edit-transition-cut-left=\{cut\.left\}/);
  assert.match(node, /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*focusWorkbenchFeature\('transition'\);\s*\}\}/);
  assert.match(node, /cut\.label/);
  assert.match(node, /cut\.durationLabel/);
});

test('video edit workbench exposes a compact creator checklist for subtitle audio and export flow', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const subtitleSegmentCount = timelineRenderPlan\.text\.length/);
  assert.match(node, /const independentAudioCount = timelineRenderPlan\.audio\.filter\(\(item\) => !item\.linkedVideoItemId\)\.length/);
  assert.match(node, /const workbenchCreatorChecklist = useMemo\(\(\) => \[/);
  assert.match(node, /key: 'subtitle'/);
  assert.match(node, /key: 'audio'/);
  assert.match(node, /key: 'export'/);
  assert.match(node, /data-video-edit-workbench-creator-checklist="true"/);
  assert.match(node, /data-video-edit-workbench-creator-checklist-item=\{item\.key\}/);
  assert.match(node, /data-video-edit-workbench-visible-feature-hub="true"/);
  assert.match(node, /data-video-edit-workbench-feature-hub-placement="timeline-detail"/);
  assert.match(node, /data-video-edit-workbench-visible-feature-item=\{item\.key\}/);
  assert.match(node, /data-video-edit-workbench-visible-feature-audit="true"/);
  assert.match(node, /data-video-edit-workbench-visible-feature-audit-item=\{item\.key\}/);
  assert.doesNotMatch(node, /grid-rows-\[auto_auto_auto_auto_auto_minmax\(0,1fr\)\]/);
  assert.match(node, /data-video-edit-workbench-property-inspector-placement="timeline-detail"/);
  assert.match(node, /data-video-edit-workbench-selected-detail-row="true"/);
  assert.match(node, /grid-rows-\[24px_18px_minmax\(220px,1fr\)_72px\]/);
  assert.match(node, /data-video-edit-workbench-visible-feature-hub-legacy="true"/);
  assert.match(node, /data-video-edit-workbench-status-strip-legacy="true"/);
  assert.match(node, /data-video-edit-workbench-output-specs="true"/);
  assert.match(node, /data-video-edit-workbench-process-card="true"/);
  assert.match(node, /data-video-edit-workbench-visible-feature-hub="true"[\s\S]{0,220}className="grid min-h-\[60px\]/);
  assert.match(node, /grid grid-cols-4 gap-1/);
  assert.match(node, /data-video-edit-workbench-status-strip="true"/);
  assert.match(node, /data-video-edit-workbench-property-inspector="true"/);
  assert.match(node, /data-video-edit-selected-item-summary="true"[\s\S]{0,260}grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(node, /const workbenchTrackOverview = useMemo\(\(\) => \[/);
  assert.match(node, /data-video-edit-workbench-track-overview="true"/);
  assert.match(node, /data-video-edit-workbench-track-overview-item=\{item\.key\}/);
  assert.match(node, /data-video-edit-workbench-track-overview-action=\{item\.key\}/);
  assert.match(node, /\{item\.actionLabel\}/);
  assert.match(node, /key: 'overlay'/);
  assert.match(node, /字幕轨/);
  assert.match(node, /叠加轨/);
  assert.match(node, /独立音频/);
  assert.match(node, /最终导出/);
  assert.match(node, /添加字幕/);
  assert.match(node, /导入音频/);
  assert.match(node, /合成视频/);
});

test('video edit workbench surfaces creator command dock and media batch actions', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const workbenchCreatorCommandItems = useMemo\(\(\) => \[/);
  assert.match(node, /const workbenchFeatureAuditItems = useMemo\(\(\) => \[/);
  assert.match(node, /key: 'timeline'/);
  assert.match(node, /key: 'subtitle'/);
  assert.match(node, /key: 'audio'/);
  assert.match(node, /key: 'overlay'/);
  assert.match(node, /key: 'cover'/);
  assert.match(node, /key: 'transition'/);
  assert.match(node, /key: 'filter'/);
  assert.match(node, /key: 'export'/);
  assert.match(node, /key: 'subtitle-style'/);
  assert.match(node, /key: 'audio-flow'/);
  assert.match(node, /key: 'pip-flow'/);
  assert.match(node, /key: 'export-flow'/);
  assert.match(node, /多轨时间线/);
  assert.match(node, /字幕轨/);
  assert.match(node, /音频轨/);
  assert.match(node, /叠加 \/ PIP/);
  assert.match(node, /封面帧/);
  assert.match(node, /转场/);
  assert.match(node, /滤镜/);
  assert.match(node, /调过渡/);
  assert.match(node, /调色/);
  assert.match(node, /输出与分离/);
  assert.match(node, /字幕样式/);
  assert.match(node, /音频分离/);
  assert.match(node, /PIP 位置/);
  assert.match(node, /合成\/无声\/提取音频/);
  assert.match(node, /data-video-edit-workbench-capability-dock="true"/);
  assert.match(node, /data-video-edit-workbench-command-rail="true"/);
  assert.match(node, /data-video-edit-workbench-capability-dock-placement="toolbar"/);
  assert.match(node, /data-video-edit-workbench-capability-dock-item=\{item\.key\}/);
  assert.match(node, /data-video-edit-workbench-feature-audit="true"/);
  assert.match(node, /data-video-edit-workbench-feature-audit-item=\{item\.key\}/);
  assert.match(node, /data-video-edit-workbench-feature-audit-action=\{item\.key\}/);
  assert.doesNotMatch(node, /data-video-edit-workbench-feature-audit="true"[\s\S]{0,220}className="[^"]*hidden[^"]*xl:grid/);
  assert.match(node, /data-video-edit-workbench-feature-audit="true"[\s\S]{0,260}className="[^"]*overflow-x-auto/);
  assert.doesNotMatch(node, /data-video-edit-workbench-capability-dock="true"[\s\S]{0,420}className="pointer-events-auto absolute/);
  assert.match(node, /handleSnapshotFrame\('cover'\)/);
  assert.match(node, /runWorkbenchCreatorCommand\(item\.key\)/);
  assert.match(node, /data-video-edit-workbench-transition-select="true"/);
  assert.match(node, /data-video-edit-workbench-filter-select="true"/);
  assert.match(node, /focusWorkbenchZone\('inspector-right'\)/);
  assert.match(node, /const addClipsToWorkbenchTimeline = \(clipIds: string\[\], mode: VideoEditWorkbenchInsertMode\) =>/);
  assert.match(node, /data-video-edit-media-batch-actions="true"/);
  assert.match(node, /data-video-edit-media-batch-action="append-visible"/);
  assert.match(node, /data-video-edit-media-batch-action="append-unused"/);
  assert.match(node, /data-video-edit-media-batch-action="overlay-selected"/);
  assert.match(node, /追加本页/);
  assert.match(node, /追加未用/);
  assert.match(node, /叠加选中/);
});

test('video edit workbench exposes export contract and batch track actions', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  const fullWorkbenchExportRows = node.match(/data-video-edit-workbench-list-row="exports"/g) || [];
  assert.equal(fullWorkbenchExportRows.length, 1, 'full workbench should keep video/audio export actions in one sticky group');

  assert.match(node, /key: 'pip'/);
  assert.match(node, /previewLimitSummary/);
  assert.match(node, /PIP 当前/);
  assert.match(node, /字幕当前/);
  assert.doesNotMatch(node, /activePreviewPipSegments[\s\S]*?slice\(-3\)/);
  assert.doesNotMatch(node, /activePreviewTextSegments[\s\S]*?slice\(-2\)/);
  assert.match(node, /data-video-edit-workbench-preview-limit-summary="true"/);
  assert.match(node, /data-preview-pip-visible=\{activePreviewPipSegments\.length\}/);
  assert.match(node, /data-preview-subtitle-total=\{subtitleSegmentCount\}/);
  assert.match(node, /data-preview-audio-visible=\{activePreviewAudioSegments\.length\}/);
  assert.match(node, /data-preview-audio-total=\{independentAudioCount\}/);
  assert.match(node, /data-preview-source-audio-active=\{\(activePreviewSourceAudioSegment \? 1 : 0\) \+ activePreviewLinkedSourceAudioSegments\.length\}/);
  assert.match(node, /data-preview-source-audio-total=\{sourceAudioCount\}/);
  assert.match(node, /const workbenchExportContractItems = useMemo\(\(\) => \[/);
  assert.match(node, /data-video-edit-workbench-export-contract="true"/);
  assert.match(node, /data-video-edit-workbench-export-contract-item=\{item\.key\}/);
  assert.match(node, /PIP/);
  assert.match(node, /烧录/);
  assert.match(node, /音频当前/);
  assert.match(node, /原声当前/);
  assert.doesNotMatch(node, /原声以导出为准/);
  assert.match(node, /const applyVideoEditTimelineBatchAction = \(/);
  assert.match(node, /data-video-edit-workbench-batch-actions="true"/);
  assert.match(node, /data-video-edit-workbench-batch-action="mute-main"/);
  assert.match(node, /data-video-edit-workbench-batch-action="restore-main"/);
  assert.match(node, /data-video-edit-workbench-batch-action="mute-independent-audio"/);
  assert.match(node, /data-video-edit-workbench-batch-action="restore-independent-audio"/);
  assert.match(node, /data-video-edit-workbench-batch-action="clear-independent-audio"/);
  assert.match(node, /data-video-edit-workbench-batch-action="clear-subtitles"/);
  assert.match(node, /data-video-edit-workbench-batch-action="clear-overlays"/);
  assert.match(node, /主轨静音/);
  assert.match(node, /清空 PIP \/ 叠加轨/);
});

test('video edit full workbench exposes only one interactive timeline selector', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  const timelineStrips = node.match(/data-video-edit-timeline-strip="true"/g) || [];
  const timelineRows = node.match(/data-video-edit-workbench-list-row="timeline"/g) || [];
  assert.equal(timelineStrips.length, 1, 'hidden legacy timelines must not share the interactive timeline selector');
  assert.equal(timelineRows.length, 1, 'hidden legacy timelines must not share the workbench timeline row selector');
  assert.match(node, /data-video-edit-legacy-stacked-timeline="detached-from-workbench-selectors"/);
  assert.doesNotMatch(node, /data-video-edit-timeline-strip="true"[^>]*className="hidden"/);
});

test('video edit transition controls stay focused and safe-area reference UI is removed', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const videoEdit = read('src/utils/videoEdit.ts');
  const transitions = read('shared/videoTransitions.json');
  const route = read('backend/src/routes/videoOps.js');

  assert.match(videoEdit, /transitionDuration:\s*0\.8/);
  assert.match(route, /Number\(settings\?\.transitionDuration\) \|\| 0\.8/);
  assert.match(node, /TRANSITION_DURATION_OPTIONS/);
  assert.match(node, /转场时长/);
  assert.match(node, /默认 0\.8s/);
  assert.doesNotMatch(node, /data-video-edit-safe-area-control="reference-only"/);
  assert.doesNotMatch(node, /SafeAreaOverlay/);
  assert.doesNotMatch(node, /安全区参考/);
  assert.doesNotMatch(node, /只显示参考框，不参与合成/);
  assert.doesNotMatch(node, /SAFE_AREA_OVERLAY_HELP = '抖音\/快手、小红书、B站竖屏、YouTube Shorts 视频遮挡参考'/);
  assert.match(transitions, /"id": "dissolve"[\s\S]*"label": "柔和溶解"[\s\S]*"xfade": "fade"/);
  assert.doesNotMatch(transitions, /"id": "dissolve"[\s\S]*"xfade": "dissolve"/);
});

test('video edit cover frame action gives visible feedback and preview', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const \[snapshotNotice, setSnapshotNotice\]/);
  assert.match(node, /setSnapshotNotice\('封面帧已设置'\)/);
  assert.match(node, /data-video-edit-cover-preview="true"/);
  assert.match(node, /data-video-edit-cover-preview-layout="preview-overlay"/);
  assert.match(node, /data-video-edit-workbench-cover-status="true"/);
  assert.match(node, /data-video-edit-workbench-cover-set=\{d\.coverImageUrl \? 'true' : 'false'\}/);
  assert.match(node, /data-video-edit-workbench-cover-thumb="true"/);
  assert.match(node, /data-video-edit-workbench-cover-action="capture"/);
  assert.doesNotMatch(node, /<section data-video-edit-cover-preview="true"/);
  assert.match(node, /d\.coverImageUrl/);
});

test('video edit preview suppresses browser-level media drag feedback', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const preventNativeMediaDrag =/);
  assert.match(node, /event\.dataTransfer\.effectAllowed = 'none'/);
  assert.match(node, /data-video-edit-preview-screen="true"[\s\S]*onDragStartCapture=\{preventNativeMediaDrag\}/);
  assert.match(node, /<video[\s\S]*draggable=\{false\}[\s\S]*onDragStart=\{preventNativeMediaDrag\}/);
  assert.match(node, /<img[\s\S]*draggable=\{false\}[\s\S]*onDragStart=\{preventNativeMediaDrag\}/);
  assert.match(node, /<input[\s\S]*type="range"[\s\S]*onPointerDown=\{stopNodePointer\}/);
});

test('video edit service explains HTML route misses as backend update issues', () => {
  const service = read('src/services/videoOps.ts');

  assert.match(service, /looksLikeHtmlRouteMiss/);
  assert.match(service, /Cannot POST/);
  assert.match(service, /视频剪辑后端接口未更新或未启动/);
  assert.match(service, /请重启后端服务或重新打开 Electron 后再试/);
});

test('video edit node uses a compact widescreen console with list settings', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-node-layout="wide-console"/);
  assert.match(node, /data-video-edit-node-stack="screen-first"/);
  assert.match(node, /data-video-edit-node-bottom-deck="true"/);
  assert.match(node, /data-video-edit-preview-screen="true"/);
  assert.match(node, /data-video-edit-node-fit="single-screen"/);
  assert.match(node, /data-video-edit-node-handle-clearance="inset-visible"/);
  assert.match(node, /<Handle type="target" position=\{Position\.Left\} className="!left-3 !z-40 !h-4 !w-4"/);
  assert.match(node, /<Handle type="source" position=\{Position\.Right\} className="!right-3 !z-40 !h-4 !w-4"/);
  assert.match(node, /h-\[744px\]/);
  assert.match(node, /h-\[652px\]/);
  assert.match(node, /data-video-edit-preview-body="fit-row"/);
  assert.doesNotMatch(node, /data-video-edit-preview-body="fit-row" className="relative h-\[300px\]/);
  assert.doesNotMatch(node, /min-w-\[760px\]/);
  assert.doesNotMatch(node, /max-w-\[760px\]/);
  assert.match(node, /data-video-edit-quick-actions="true"/);
  assert.match(node, /data-video-edit-action-row="centered"/);
  assert.match(node, /inline-flex h-8 items-center justify-center/);
  assert.match(node, /上传或导入视频/);
  assert.doesNotMatch(node, /轻点上传或从上游导入视频，也可以打开剪辑台开始整理/);
  assert.match(node, /data-video-edit-node-timeline="duration-track"/);
  assert.match(node, /data-video-edit-timeline-placement="between-actions-and-settings"/);
  assert.match(node, /data-video-edit-timeline-adaptive="duration-flex"/);
  assert.match(node, /data-video-edit-timeline-track="full-height"/);
  assert.match(node, /const measuredDuration = duration > 0\.25 \? duration : Number\(clip\.duration \|\| clip\.trimEnd \|\| 0\)/);
  assert.match(node, /const layoutDuration = Math\.max\(1, measuredDuration > 0\.25 \? measuredDuration : 5\)/);
  assert.match(node, /flexGrow: layoutDuration/);
  assert.match(node, /h-full min-w-\[96px\]/);
  assert.match(node, /data-video-edit-compact-lists="true"/);
  assert.match(node, /data-video-edit-compact-list-mode="selects"/);
  assert.match(node, /data-video-edit-current-clip-summary="true"/);
  assert.match(node, /data-video-edit-option-list="presets"/);
  assert.match(node, /data-video-edit-option-list="schemes"/);
  assert.match(node, /data-video-edit-option-list="settings"/);
  assert.match(node, /COMPACT_ASPECT_OPTIONS/);
  assert.match(node, /COMPACT_RESOLUTION_OPTIONS/);
  assert.match(node, /label: '首段'/);
  assert.match(node, /title=\{ASPECT_OPTIONS\.find\(\(item\) => item\.value === settings\.aspect\)\?\.label/);
  assert.match(node, /title=\{RESOLUTION_OPTIONS\.find\(\(item\) => item\.value === settings\.resolution\)\?\.label/);
  assert.match(node, /pr-7/);
  assert.match(node, /data-video-edit-node-detail-gate="true"/);
  assert.match(node, /剪辑台细调/);
  assert.match(node, /grid-rows-\[minmax\(260px,1fr\)_38px_144px_158px\]/);
  assert.match(node, /grid-cols-\[220px_230px_minmax\(280px,1fr\)_270px\]/);
  assert.doesNotMatch(node, /data-video-edit-node-timeline="compact-filmstrip"/);
  assert.doesNotMatch(node, /min-h-0 overflow-y-auto rounded-lg border p-2 text-\[11px\]/);
  assert.match(node, /<select[\s\S]*value=\{settings\.outputPreset \|\| 'custom'\}/);
  assert.match(node, /<select[\s\S]*value=\{settings\.creatorTemplate \|\| 'manual'\}/);
  assert.doesNotMatch(node, /max-h-\[640px\] grid-rows-\[auto_auto_auto_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(node, /data-video-edit-settings-list="true" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3"/);
});

test('video edit compact control buttons keep visible button chrome in light mode', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const styles = read('src/styles/index.css');

  assert.match(node, /--t8-video-edit-action-bg/);
  assert.match(node, /--t8-video-edit-action-border/);
  assert.match(node, /--t8-video-edit-action-shadow/);

  for (const label of ['均分', '压缩', '排序', '剪辑台细调', '导入配方', '导出配方', '套餐', '无声', '音频', '源节点', '输出']) {
    assert.match(
      node,
      new RegExp(`data-video-edit-compact-action-button="true"[\\s\\S]{0,260}>${label}<\\/button>`),
      `${label} should use the compact action button skin`,
    );
  }

  assert.match(styles, /\[data-video-edit-compact-action-button="true"\]/);
  assert.match(styles, /background:\s*var\(--t8-video-edit-action-bg\)/);
  assert.match(styles, /border-color:\s*var\(--t8-video-edit-action-border\)/);
  assert.match(styles, /box-shadow:\s*var\(--t8-video-edit-action-shadow\)/);
  assert.match(styles, /\[data-video-edit-compact-action-button="true"\]:disabled/);
});

test('video edit RH light palette follows theme mode instead of template dark list', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const shouldUseDarkSurface = theme === 'dark'/);
  assert.match(node, /theme !== 'light'[\s\S]{0,120}VIDEO_EDIT_DARK_TEMPLATE_IDS\.has\(id\)/);
  assert.doesNotMatch(
    node,
    /if \(theme === 'dark' \|\| style === 'tech' \|\| VIDEO_EDIT_DARK_TEMPLATE_IDS\.has\(id\)\)/,
  );
});

test('video edit workbench uses a studio timeline with preview, tracks, and tool panels', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-workbench="true"/);
  assert.match(node, /role="dialog"/);
  assert.match(node, /aria-modal="true"/);
  assert.match(node, /aria-label="视频剪辑台"/);
  assert.match(node, /overflow-hidden/);
  assert.match(node, /h-\[calc\(100vh-0\.75rem\)\]/);
  assert.match(node, /data-video-edit-workbench-viewport-fill="true"/);
  assert.match(node, /max-w-none/);
  assert.match(node, /data-video-edit-workbench-layout="studio-timeline"/);
  assert.match(node, /data-video-edit-workbench-layout-version="capcut-workbench-v7"/);
  assert.match(node, /data-video-edit-workbench-bottom-timeline="dominant"/);
  assert.match(node, /data-video-edit-workbench-timeline-min-height="responsive-290-520"/);
  assert.match(node, /data-video-edit-workbench-toolbar="true"/);
  assert.match(node, /data-video-edit-workbench-feature-strip="true"/);
  assert.match(node, /const workbenchTopStatusItems = useMemo/);
  assert.match(node, /const workbenchInspectorActionItems = useMemo/);
  assert.match(node, /const featureKey = item\.key === 'export' \? 'output' : item\.key/);
  assert.match(node, /data-video-edit-workbench-feature=\{featureKey\}/);
  assert.match(node, /data-video-edit-workbench-feature-status=\{item\.status\}/);
  assert.match(node, /workbenchCreatorCommandItems\.map/);
  assert.match(node, /runWorkbenchCreatorCommand\(item\.key\)/);
  assert.match(node, /if \(key === 'cover'\) void handleSnapshotFrame\('cover'\)/);
  assert.match(node, /data-video-edit-workbench-transition-select="true"/);
  assert.match(node, /data-video-edit-workbench-filter-select="true"/);
  assert.match(node, /data-video-edit-workbench-screen="true"/);
  assert.match(node, /data-video-edit-workbench-top-screen="true"/);
  assert.match(node, /data-video-edit-workbench-control-deck="true"/);
  assert.match(node, /data-video-edit-workbench-stack="preview-with-bottom-timeline"/);
  assert.match(node, /data-video-edit-workbench-main-grid="full-viewport-library-preview-inspector-bottom-multitrack"/);
  assert.match(node, /data-video-edit-workbench-panel-widths="left-300-center-fluid-right-380"/);
  assert.match(node, /data-video-edit-workbench-bottom-deck="true"/);
  assert.match(node, /data-video-edit-workbench-track-editor="true"/);
  assert.match(node, /data-video-edit-track-toolbar="true"/);
  assert.match(node, /data-video-edit-timeline-ruler="true"/);
  assert.match(node, /data-video-edit-track-lanes="true"/);
  assert.match(node, /data-video-edit-track-lane="video"/);
  assert.match(node, /data-video-edit-track-lane="overlay"/);
  assert.match(node, /data-video-edit-track-lane="audio"/);
  assert.match(node, /data-video-edit-track-lane="text"/);
  assert.match(node, /grid-rows-\[minmax\(76px,1fr\)_minmax\(42px,0\.38fr\)_minmax\(42px,0\.38fr\)_minmax\(42px,0\.38fr\)\]/);
  assert.match(node, /data-video-edit-timeline-overlay-item-id/);
  assert.match(node, /data-video-edit-overlay-empty-action="true"/);
  assert.match(node, /data-video-edit-track-lane-action="mute"/);
  assert.match(node, /data-video-edit-track-lane-action="add-audio"/);
  assert.match(node, /data-video-edit-track-lane-action="add-subtitle"/);
  assert.match(node, /data-video-edit-subtitle-input="true"/);
  assert.match(node, /data-video-edit-workbench-tools-row="true"/);
  assert.match(node, /data-video-edit-workbench-media-bin="true"/);
  assert.match(node, /data-video-edit-workbench-clip-inspector="true"/);
  assert.match(node, /data-video-edit-workbench-export-panel="true"/);
  assert.match(node, /data-video-edit-workbench-output-specs="true"/);
  assert.match(node, /data-video-edit-workbench-output-preset="true"/);
  assert.match(node, /data-video-edit-workbench-output-aspect="true"/);
  assert.match(node, /data-video-edit-workbench-output-resolution="true"/);
  assert.match(node, /data-video-edit-workbench-output-duration="true"/);
  assert.match(node, /data-video-edit-workbench-process-card="true"/);
  assert.match(node, /data-video-edit-workbench-template-select="true"/);
  assert.match(node, /data-video-edit-workbench-audio-select="true"/);
  assert.match(node, /data-video-edit-workbench-sticky-actions="true"/);
  assert.match(node, /data-video-edit-workbench-status-strip="true"/);
  assert.match(node, /data-video-edit-workbench-property-inspector="true"/);
  assert.match(node, /data-video-edit-workbench-capability-list="true"/);
  assert.match(node, /data-video-edit-workbench-track-overview="true"/);
  assert.match(node, /className="grid min-h-0 flex-1 gap-1 overflow-hidden px-2 pb-0\.5 pt-0\.5"/);
  assert.match(node, /data-video-edit-workbench-responsive-safe="true"/);
  assert.match(node, /min-w-0 resize overflow-hidden rounded-2xl/);
  assert.doesNotMatch(node, /min-w-\[1280px\]/);
  assert.match(node, /gridTemplateColumns:\s*'minmax\(240px, 300px\) minmax\(520px, 1fr\) minmax\(280px, 380px\)'/);
  assert.match(node, /gridTemplateRows:\s*'minmax\(220px, 0\.38fr\) minmax\(344px, 0\.62fr\)'/);
  assert.match(node, /className="relative col-start-2 row-start-1 min-h-0 overflow-hidden rounded-xl bg-black"/);
  assert.match(node, /data-video-edit-workbench-zone="timeline-bottom"[\s\S]*className="col-span-3 row-start-2/);
  assert.match(node, /data-video-edit-workbench-zone="inspector-right"[\s\S]*data-video-edit-workbench-output-panel="true"/);
  assert.match(node, /data-video-edit-workbench-property-inspector-placement="timeline-detail"/);
  assert.match(node, /data-video-edit-workbench-list-row="materials"/);
  assert.match(node, /data-video-edit-workbench-list-row="timeline"/);
  assert.match(node, /data-video-edit-workbench-list-row="clip-controls"/);
  assert.match(node, /data-video-edit-workbench-list-row="schemes"/);
  assert.match(node, /data-video-edit-workbench-list-row="publish-specs"/);
  assert.match(node, /data-video-edit-workbench-list-row="process-settings"/);
  assert.match(node, /data-video-edit-workbench-list-row="settings"/);
  assert.match(node, /data-video-edit-workbench-list-row="exports"/);
  assert.doesNotMatch(node, /grid-rows-\[auto_auto_auto_auto_auto_minmax\(0,1fr\)\]/);
  assert.match(node, /grid-rows-\[auto_auto_auto\]/);
  assert.match(node, /上传视频/);
  assert.match(node, /导入上游/);
  assert.match(node, /打开剪辑台/);
  assert.match(node, /视频轨/);
  assert.match(node, /叠加轨/);
  assert.match(node, /音频轨/);
  assert.match(node, /字幕轨/);
  assert.match(node, /片段库/);
  assert.match(node, /片段细剪/);
  assert.match(node, /输出设置/);
  assert.doesNotMatch(node, /grid-rows-\[minmax\(360px,1fr\)_minmax\(240px,320px\)\]/);
  assert.doesNotMatch(node, /grid-rows-\[minmax\(0,1fr\)_auto_auto\]/);
  assert.doesNotMatch(node, /data-video-edit-workbench-layout="clean-wide-console"/);
  assert.doesNotMatch(node, /data-video-edit-workbench-stack="screen-first"/);
  assert.doesNotMatch(node, /grid h-\[300px\] min-h-\[280px\] grid-cols-\[300px_minmax\(420px,1fr\)_360px\]/);
  assert.match(node, /data-video-edit-material-basket="true"/);
  assert.match(node, /片段库/);
  assert.match(node, /当前窗口/);
  assert.match(node, /选择片段后可在中间细剪/);
  assert.match(node, /data-video-edit-preview-stage="true"/);
  assert.match(node, /data-video-edit-timeline-strip="true"/);
  assert.match(node, /data-video-edit-workbench-timeline-panel="true"/);
  assert.match(node, /data-video-edit-workbench-output-panel="true"/);
  assert.match(node, /data-video-edit-inspector="true"/);
  assert.match(node, /输出设置/);
  assert.match(node, /发布规格/);
  assert.match(node, /处理方式/);
  assert.match(node, /属性检查器/);
  assert.match(node, /handleWorkbenchClipCardKeyDown/);
  assert.match(node, /aria-selected=\{selectedClip\?\.id === clip\.id\}/);
  assert.doesNotMatch(node, /md:grid-cols-\[1fr_220px\]/);
  assert.doesNotMatch(node, /lg:grid-cols-\[210px_1fr_300px\]/);
  assert.doesNotMatch(node, /grid-cols-\[300px_minmax\(0,1fr\)_360px\]/);
  assert.doesNotMatch(node, /grid-cols-\[minmax\(0,1fr\)_minmax\(340px,460px\)\]/);
  assert.doesNotMatch(node, /grid-cols-\[320px_minmax\(0,1fr\)_420px\]/);
  assert.doesNotMatch(node, /data-video-edit-workbench-layout-version="capcut-bottom-timeline-v4"/);
  assert.doesNotMatch(node, /data-video-edit-workbench-stack="preview-top-timeline-bottom"/);
  assert.doesNotMatch(node, /data-video-edit-workbench-main-grid="preview-panels-timeline"/);
  assert.doesNotMatch(node, /gridTemplateRows:\s*'minmax\(380px, 1fr\) minmax\(132px, 0\.28fr\) minmax\(340px, 0\.78fr\)'/);
  assert.doesNotMatch(node, /col-span-3 row-start-1/);
  assert.doesNotMatch(node, /col-span-3 row-start-3/);
  assert.doesNotMatch(node, /col-start-1 row-start-2/);
  assert.doesNotMatch(node, /col-span-2 col-start-2 row-start-2/);
  assert.doesNotMatch(node, /data-video-edit-workbench-clip-inspector="true"[\s\S]*className="col-span-2 row-start-2/);
  assert.doesNotMatch(node, /data-video-edit-workbench-zone="inspector-right"[\s\S]*className="col-start-3 row-span-2 row-start-1/);
  assert.doesNotMatch(node, /h-\[min\(90vh,900px\)\]/);
  assert.doesNotMatch(node, /max-h-\[210px\] overflow-y-auto rounded-xl border p-3/);
  assert.doesNotMatch(node, /order-2 col-start-1 row-start-2 flex min-h-0 max-h-\[300px\]/);
  assert.doesNotMatch(node, /order-3 col-start-3 row-start-2 flex min-h-0 max-h-\[300px\]/);
  assert.doesNotMatch(node, /fixed inset-0 z-\[2147483000\] overflow-auto/);
  assert.doesNotMatch(node, /order-3 grid gap-3 rounded-xl border p-3 md:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(node, /bg-white\/7[05]/);
});

test('video edit surfaces stay solid and theme-safe across visual themes', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-node-theme-surface="solid"/);
  assert.match(node, /data-video-edit-workbench-theme-surface="solid"/);
  assert.match(node, /function resolveVideoEditSolidPalette/);
  assert.match(node, /useThemeStore\(\(state\) => state\.templateId\)/);
  assert.match(node, /--t8-video-edit-surface/);
  assert.match(node, /--t8-video-edit-panel/);
  assert.match(node, /--t8-video-edit-muted/);
  assert.match(node, /--t8-video-edit-card/);
  assert.match(node, /background: 'var\(--t8-video-edit-surface\)'/);
  assert.match(node, /background: 'var\(--t8-video-edit-panel\)'/);
  assert.match(node, /background: 'var\(--t8-video-edit-muted\)'/);
  assert.match(node, /background: 'var\(--t8-video-edit-card\)'/);
  assert.match(node, /borderColor: 'var\(--t8-border\)'/);
  assert.doesNotMatch(node, /backdrop-blur/);
  assert.doesNotMatch(node, /filter:\s*blur/);
  assert.doesNotMatch(node, /text-shadow/);
  assert.doesNotMatch(node, /bg-white\/[0-9]/);
});

test('video edit data can carry timeline v2 without breaking legacy clips', () => {
  const videoEdit = read('src/utils/videoEdit.ts');

  assert.match(videoEdit, /import \{[\s\S]*timelineItemDuration as getVideoEditTimelineItemDuration[\s\S]*type VideoEditTimelineItem[\s\S]*type VideoEditTimelineRenderPlan[\s\S]*type VideoEditTimelineV2[\s\S]*\} from '\.\/videoTimeline'/);
  assert.match(videoEdit, /timelineV2\?: VideoEditTimelineV2/);
  assert.match(videoEdit, /renderPlan\?: VideoEditTimelineRenderPlan/);
  assert.match(videoEdit, /timelineV2:\s*undefined/);
  assert.match(videoEdit, /renderPlan:\s*input\.renderPlan/);
  assert.match(videoEdit, /timelineV2:\s*input\.timelineV2/);
  assert.match(videoEdit, /const timelineV2 = raw\.timelineV2 \? normalizeVideoEditTimeline\(raw\.timelineV2, clips\) : undefined/);
  assert.match(videoEdit, /const renderPlan = raw\.renderPlan && typeof raw\.renderPlan === 'object'/);
  assert.match(videoEdit, /export \{[\s\S]*createVideoEditTimelineFromClips[\s\S]*\} from '\.\/videoTimeline'/);
  assert.match(videoEdit, /export \{[\s\S]*normalizeVideoEditTimeline[\s\S]*\} from '\.\/videoTimeline'/);
  assert.match(videoEdit, /export \{[\s\S]*splitVideoEditTimelineItem[\s\S]*\} from '\.\/videoTimeline'/);
  assert.match(videoEdit, /export \{[\s\S]*detectVideoEditTimelineConflicts[\s\S]*\} from '\.\/videoTimeline'/);
  assert.match(videoEdit, /export type \{[\s\S]*VideoEditTimelineTrack[\s\S]*VideoEditTimelineV2[\s\S]*\} from '\.\/videoTimeline'/);
});

test('video edit workbench is driven by timeline v2 and exposes professional editor zones', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /normalizeVideoEditTimeline/);
  assert.match(node, /videoEditTimelineDuration/);
  assert.match(node, /detectVideoEditTimelineConflicts/);
  assert.match(node, /timelineV2/);
  assert.match(node, /data-video-edit-workbench-layout-version="capcut-workbench-v7"/);
  assert.match(node, /data-video-edit-workbench-bottom-timeline="dominant"/);
  assert.match(node, /data-video-edit-workbench-zone="media-bin-left"/);
  assert.match(node, /data-video-edit-workbench-zone="preview-stage-center"/);
  assert.match(node, /data-video-edit-workbench-zone="inspector-right"/);
  assert.match(node, /data-video-edit-workbench-zone="timeline-bottom"/);
  assert.match(node, /data-video-edit-workbench-zone="multitrack-timeline"/);
  assert.match(node, /data-video-edit-timeline-source="timeline-v2-items"/);
  assert.match(node, /data-video-edit-track-kind="video"/);
  assert.match(node, /data-video-edit-track-kind="audio"/);
  assert.match(node, /data-video-edit-track-kind="text"/);
  assert.match(node, /workbenchTimelineItems\.map/);
  assert.match(node, /timelineRenderPlan\.text/);
  assert.match(node, /data-video-edit-timeline-item-id=\{item\.id\}/);
  assert.match(node, /data-video-edit-timeline-audio-item-id=\{item\.sourceItemId\}/);
  assert.match(node, /timelineV2Duration/);
  assert.match(node, /timelineV2Conflicts/);
});

test('video edit compose requests use timeline render plan as the export source', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const videoEdit = read('src/utils/videoEdit.ts');
  const service = read('src/services/videoOps.ts');
  const backend = read('backend/src/routes/videoOps.js');

  assert.match(videoEdit, /buildVideoEditTimelineRenderPlan/);
  assert.match(videoEdit, /videoEditClipsFromTimelineRenderPlan/);
  assert.match(node, /const timelineRenderPlan = useMemo\(\(\) => buildVideoEditTimelineRenderPlan\(timelineV2\), \[timelineV2\]\)/);
  assert.match(node, /const timelineComposeClips = useMemo\(\(\) => videoEditClipsFromTimelineRenderPlan\(timelineRenderPlan\), \[timelineRenderPlan\]\)/);
  assert.match(node, /const canCompose = timelineComposeClips\.length > 0/);
  assert.match(node, /createVideoEditExecutionInputSnapshot\(\{[\s\S]*clips: timelineComposeClips[\s\S]*renderPlan: timelineRenderPlan/);
  assert.match(node, /composeVideoEditAsync\(snapshot\.clips, operationSettings,[\s\S]*timelineV2: snapshot\.timelineV2,[\s\S]*renderPlan: snapshot\.renderPlan/);
  assert.match(node, /separateVideoAudioAsync\(timelineComposeClips, settings, mode, \{ timelineV2, renderPlan: timelineRenderPlan \}\)/);
  assert.match(node, /if \(!timelineComposeClips\.length \|\| running \|\| busy === 'upload'\) return/);
  assert.match(service, /interface VideoComposeOptions/);
  assert.match(service, /renderPlan\?: VideoEditTimelineRenderPlan/);
  assert.match(service, /postVideoOp<VideoJobStatus>\('compose', \{ clips, settings, async: true, \.\.\.options \}, requestOptions\)/);
  assert.match(backend, /resolveVideoEditClipPayload/);
  assert.match(backend, /resolveVideoEditRenderPlanPayload/);
  assert.match(backend, /buildSubtitleDrawtextFilters/);
  assert.match(backend, /renderPlanClips = Array\.isArray\(body\?\.renderPlan\?\.clips\)/);
});

test('video edit compose and platform export run through durable secondary-action evidence', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const service = read('src/services/videoOps.ts');
  const backend = read('backend/src/routes/videoOps.js');
  const canvas = read('src/components/Canvas.tsx');

  assert.match(node, /actionId: 'video-edit\.compose'/);
  assert.match(node, /actionId: 'video-edit\.platform-export'/);
  assert.match(node, /registerSecondaryProviderActionExecutor\(id, 'video-edit\.compose', 'compose'/);
  assert.match(node, /reporter\.providerRequest[\s\S]*composeVideoEditAsync[\s\S]*reporter\.providerSubmitted/);
  assert.match(node, /awaitVideoOperationTerminal/);
  assert.match(node, /reporter\.providerPolling/);
  assert.match(node, /reporter\.output/);
  assert.match(service, /executionEvidence\?: VideoOperationExecutionEvidence/);
  assert.match(service, /executionInput\?: VideoEditExecutionInputSnapshot/);
  assert.match(backend, /validateVideoOperationInputBinding/);
  assert.match(backend, /reconstructDurableVideoOperationJob/);
  assert.match(canvas, /secondaryProviderActionInputDigest/);
  assert.doesNotMatch(node, /handleCompose[\s\S]{0,900}composeVideoEditAsync/);
});

test('video edit workbench uses a creator-first multitrack layout instead of legacy stacked panels', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-workbench-layout-version="capcut-workbench-v7"/);
  assert.match(node, /data-video-edit-workbench-bottom-timeline="dominant"/);
  assert.match(node, /data-video-edit-workbench-stack="preview-with-bottom-timeline"/);
  assert.match(node, /data-video-edit-workbench-main-grid="full-viewport-library-preview-inspector-bottom-multitrack"/);
  assert.match(node, /data-video-edit-workbench-panel-widths="left-300-center-fluid-right-380"/);
  assert.match(node, /data-video-edit-timeline-source="timeline-v2-items"/);
  assert.match(node, /data-video-edit-workbench-zone="media-bin-left"/);
  assert.match(node, /data-video-edit-workbench-zone="preview-stage-center"/);
  assert.match(node, /data-video-edit-workbench-zone="inspector-right"/);
  assert.match(node, /data-video-edit-workbench-zone="timeline-bottom"/);
  assert.match(node, /gridTemplateColumns:\s*'minmax\(240px, 300px\) minmax\(520px, 1fr\) minmax\(280px, 380px\)'/);
  assert.match(node, /gridTemplateRows:\s*'minmax\(220px, 0\.38fr\) minmax\(344px, 0\.62fr\)'/);
  assert.match(node, /const workbenchTimelineItems =/);
  assert.match(node, /timelineV2\.items/);
  assert.match(node, /workbenchTimelineItems\.map/);
  assert.doesNotMatch(node, /data-video-edit-workbench-layout-version="capcut-bottom-timeline-v4"/);
  assert.doesNotMatch(node, /data-video-edit-workbench-layout-version="timeline-v2-studio"/);
  assert.doesNotMatch(node, /grid-rows-\[minmax\(360px,1fr\)_180px_220px\]/);
});

test('video edit workbench pins the multitrack timeline across the bottom instead of side columns', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /data-video-edit-workbench-layout-version="capcut-workbench-v7"/);
  assert.match(node, /data-video-edit-workbench-bottom-timeline="dominant"/);
  assert.match(node, /data-video-edit-workbench-stack="preview-with-bottom-timeline"/);
  assert.match(node, /data-video-edit-workbench-main-grid="full-viewport-library-preview-inspector-bottom-multitrack"/);
  assert.match(node, /data-video-edit-workbench-panel-widths="left-300-center-fluid-right-380"/);
  assert.match(node, /gridTemplateColumns:\s*'minmax\(240px, 300px\) minmax\(520px, 1fr\) minmax\(280px, 380px\)'/);
  assert.match(node, /gridTemplateRows:\s*'minmax\(220px, 0\.38fr\) minmax\(344px, 0\.62fr\)'/);
  assert.match(node, /data-video-edit-workbench-zone="timeline-bottom"[\s\S]*className="col-span-3 row-start-2/);
  assert.match(node, /data-video-edit-workbench-zone="media-bin-left"[\s\S]*className="col-start-1 row-start-1/);
  assert.match(node, /data-video-edit-workbench-zone="preview-stage-center"[\s\S]*className="relative col-start-2 row-start-1/);
  assert.match(node, /data-video-edit-workbench-zone="inspector-right"[\s\S]*className="col-start-3 row-start-1/);
  assert.match(node, /data-video-edit-workbench-zone="inspector-right"[\s\S]*data-video-edit-workbench-clip-inspector="true"/);
  assert.doesNotMatch(node, /data-video-edit-workbench-clip-inspector="true"[\s\S]*className="col-span-2 row-start-2/);
  assert.doesNotMatch(node, /data-video-edit-workbench-zone="inspector-right"[\s\S]*className="col-start-3 row-span-2 row-start-1/);
  assert.doesNotMatch(node, /grid-cols-\[280px_minmax\(0,1fr\)_340px\] grid-rows-\[minmax\(420px,0\.9fr\)_minmax\(320px,1fr\)\]/);
});

test('video edit full workbench can import independent audio into the audio track', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const audioTrackInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(node, /data-video-edit-audio-track-input="true"/);
  assert.match(node, /accept="audio\/\*,\.mp3,\.wav,\.m4a,\.aac,\.ogg,\.flac,\.webm"/);
  assert.match(node, /handleAudioTrackUpload/);
  assert.match(node, /addAudioFileToTimeline/);
  assert.match(node, /audioTrackInputRef\.current\?\.click\(\)/);
  assert.match(node, /timelineRenderPlan\.audio/);
  assert.match(node, /data-video-edit-independent-audio-item-id=\{item\.linkedVideoItemId \? undefined : item\.sourceItemId\}/);
  assert.match(node, /track-audio-independent/);
  assert.doesNotMatch(node, /showAudioTrackPlaceholder/);
  assert.doesNotMatch(node, /独立音频轨会在下一版接入/);
});

test('video edit full workbench previews independent audio against the timeline playhead', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const previewAudioRefs = useRef<Record<string, HTMLAudioElement \| null>>/);
  assert.match(node, /const previewEnabledAudioSegments = useMemo/);
  assert.match(node, /const activePreviewAudioSegments = useMemo/);
  assert.match(node, /!item\.linkedVideoItemId/);
  assert.match(node, /const sourcePreviewAudioSegments = useMemo/);
  assert.match(node, /const activePreviewSourceAudioSegment = useMemo/);
  assert.match(node, /const activePreviewLinkedSourceAudioSegments = useMemo/);
  assert.match(node, /item\.linkedVideoItemId !== activePlaybackItemId/);
  assert.match(node, /const activePreviewAudioPlaybackSegments = useMemo/);
  assert.match(node, /activePreviewAudioPlaybackSegments\.map/);
  assert.match(node, /!!item\.linkedVideoItemId/);
  assert.match(node, /const previewMainVideoMuted = !activePreviewSourceAudioSegment/);
  assert.match(node, /const previewAudioSegmentSourceTime = previewOverlaySegmentSourceTime/);
  assert.match(node, /const syncActivePreviewAudioTracks =/);
  assert.match(node, /previewAudioRefs\.current\[segment\.sourceItemId\]/);
  assert.match(node, /previewAudio\.volume = volume/);
  assert.match(node, /previewAudio\.currentTime = sourceTime/);
  assert.match(node, /const syncActivePreviewMedia =/);
  assert.match(node, /syncActivePreviewAudioTracks\(mode\)/);
  assert.match(node, /onPause=\{\(\) => syncActivePreviewMedia\('pause'\)\}/);
  assert.match(node, /onSeeked=\{\(\) => syncActivePreviewMedia\(\)\}/);
  assert.match(node, /data-video-edit-preview-audio-track="true"/);
  assert.match(node, /data-video-edit-preview-audio-source-item-id=\{segment\.sourceItemId\}/);
  assert.match(node, /data-video-edit-preview-audio-source-time=\{previewAudioSegmentSourceTime\(segment\)\}/);
  assert.match(node, /onLoadedMetadata=\{\(\) => syncActivePreviewAudioTracks\(\)\}/);
  assert.match(node, /data-video-edit-preview-source-audio-active=\{activePreviewSourceAudioSegment \? 'true' : 'false'\}/);
  assert.match(node, /data-video-edit-preview-main-muted=\{previewMainVideoMuted \? 'true' : 'false'\}/);
  assert.match(node, /muted=\{previewMainVideoMuted\}/);
});

test('video edit full workbench exposes audio fades and volume curve controls', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const timeline = read('src/utils/videoTimeline.ts');
  const videoEdit = read('src/utils/videoEdit.ts');

  assert.match(videoEdit, /videoEditAudioEnvelopeMultiplier/);
  assert.match(timeline, /export type VideoEditAudioVolumeCurve/);
  assert.match(timeline, /export const VIDEO_EDIT_AUDIO_VOLUME_CURVES/);
  assert.match(timeline, /export function normalizeVideoEditAudioFade/);
  assert.match(timeline, /export function videoEditAudioEnvelopeMultiplier/);
  assert.match(node, /VIDEO_EDIT_AUDIO_VOLUME_CURVE_OPTIONS/);
  assert.match(node, /const patchTimelineItemAudioEnvelope = \(itemId: string, patch: Partial<VideoEditTimelineItem>\) =>/);
  assert.match(node, /audioFadeIn: selectedTimelineItemDetail\.audioFadeIn/);
  assert.match(node, /audioFadeOut: selectedTimelineItemDetail\.audioFadeOut/);
  assert.match(node, /volumeCurve: selectedTimelineItemDetail\.volumeCurve/);
  assert.match(node, /videoEditAudioEnvelopeMultiplier\(activePreviewSourceAudioSegment, previewTimelineSecond\)/);
  assert.match(node, /videoEditAudioEnvelopeMultiplier\(segment, previewTimelineSecond\)/);
  assert.match(node, /data-video-edit-audio-envelope-controls="true"/);
  assert.match(node, /data-video-edit-audio-fade-in-current=\{selectedTimelineItemDetail\.audioFadeIn\}/);
  assert.match(node, /data-video-edit-audio-fade-out-current=\{selectedTimelineItemDetail\.audioFadeOut\}/);
  assert.match(node, /data-video-edit-audio-volume-curve-current=\{selectedTimelineItemDetail\.volumeCurve\}/);
  assert.match(node, /data-video-edit-audio-envelope-action="fade-in-1"/);
  assert.match(node, /data-video-edit-audio-envelope-action="fade-out-1"/);
  assert.match(node, /data-video-edit-audio-envelope-action="fade-both-1"/);
  assert.match(node, /data-video-edit-audio-envelope-action="clear"/);
  assert.match(node, /data-video-edit-audio-volume-curve=\{option\.value\}/);
});

test('video edit preview stays blank when the timeline playhead is in an empty gap', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const timeline = read('src/utils/videoTimeline.ts');

  assert.match(timeline, /const item = preferredAtPlayhead \|\| containing \|\| null/);
  assert.match(node, /const timelinePreviewIsEmptyGap = timelineHasVideoItems && !timelinePlayback\.item/);
  assert.match(node, /const previewOverrideMatchesTimeline = !timelinePreviewIsEmptyGap &&/);
  assert.match(node, /const selectedClip = timelinePreviewIsEmptyGap \? null :/);
});

test('video edit full workbench aligns audio and subtitle lanes to the same timeline ruler', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const workbenchAudioTimelineViewportRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(node, /const workbenchTextTimelineViewportRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(node, /const syncWorkbenchTimelineScroll =/);
  assert.match(node, /data-video-edit-workbench-primary-scroll="true"/);
  assert.match(node, /data-video-edit-workbench-synced-scroll="audio"/);
  assert.match(node, /data-video-edit-workbench-synced-scroll="text"/);
  assert.match(node, /workbenchTimelineTrackItemStyle\(item\.timelineStart, item\.timelineEnd, 112\)/);
  assert.match(node, /workbenchTimelineTrackItemStyle\(item\.timelineStart, item\.timelineEnd, 120\)/);
  assert.match(node, /data-video-edit-track-item-left=\{item\.timelineStart\}/);
  assert.match(node, /data-video-edit-track-item-width=\{item\.timelineEnd - item\.timelineStart\}/);
  assert.match(node, /grid-rows-\[minmax\(76px,1fr\)_minmax\(42px,0\.38fr\)_minmax\(42px,0\.38fr\)_minmax\(42px,0\.38fr\)\]/);
  assert.doesNotMatch(node, /timelineRenderPlan\.audio\.length \? timelineRenderPlan\.audio\.map[\s\S]{0,900}className="flex min-w-0 gap-2 overflow-x-auto/);
  assert.doesNotMatch(node, /timelineRenderPlan\.text\.length \? timelineRenderPlan\.text\.map[\s\S]{0,900}className="flex min-w-0 gap-2 overflow-x-auto/);
});

test('video edit full workbench exposes track lock hide and solo controls', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const toggleTrackStart = node.indexOf('const toggleVideoEditTimelineTrackFlag = (');
  const toggleTrackEnd = node.indexOf('const expandVideoEditTimelineItemIds =', toggleTrackStart);
  const toggleTrackBody = node.slice(toggleTrackStart, toggleTrackEnd);

  assert.match(node, /toggleVideoEditTimelineTrackFlag/);
  assert.match(node, /data-video-edit-track-controls="video"/);
  assert.match(node, /data-video-edit-track-controls="audio"/);
  assert.match(node, /data-video-edit-track-controls="text"/);
  assert.match(node, /data-video-edit-track-action="lock"/);
  assert.match(node, /data-video-edit-track-action="hide"/);
  assert.match(node, /data-video-edit-track-action="solo"/);
  assert.match(node, /data-video-edit-track-action="delete"/);
  assert.match(node, /const clearVideoEditTimelineTrack = \(track: VideoEditTimelineTrack\) =>/);
  assert.match(node, /const getVideoEditTrackClearItemIds = \(sourceTimeline: VideoEditTimelineV2, track: VideoEditTimelineTrack\) =>/);
  assert.match(node, /清空轨道/);
  assert.match(node, /track\.locked/);
  assert.match(node, /track\.hidden/);
  assert.match(node, /track\.solo/);
  assert.ok(toggleTrackStart >= 0 && toggleTrackEnd > toggleTrackStart);
  assert.ok(toggleTrackBody.includes('rememberWorkbenchChange();'));
  assert.ok(toggleTrackBody.indexOf('rememberWorkbenchChange();') < toggleTrackBody.indexOf('update({'));
});

test('video edit full workbench exposes real timeline editing commands and item actions', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const addSubtitleStart = node.indexOf('const addSubtitleToTimeline = () =>');
  const addSubtitleEnd = node.indexOf('const loadClipTimelinePreview =', addSubtitleStart);
  const addSubtitleBody = node.slice(addSubtitleStart, addSubtitleEnd);
  const muteClipStart = node.indexOf('const toggleClipMuted = (clipId: string) =>');
  const muteClipEnd = node.indexOf('const toggleAllClipMuted = () =>', muteClipStart);
  const muteClipBody = node.slice(muteClipStart, muteClipEnd);

  assert.match(node, /type VideoEditWorkbenchSnapshot/);
  assert.match(node, /data-video-edit-workbench-edit-toolbar="true"/);
  assert.match(node, /data-video-edit-workbench-action="undo"/);
  assert.match(node, /data-video-edit-workbench-action="redo"/);
  assert.match(node, /data-video-edit-workbench-action="split-at-playhead"/);
  assert.match(node, /data-video-edit-workbench-action="duplicate-selected"/);
  assert.match(node, /data-video-edit-workbench-action="delete-selected"/);
  assert.match(node, /data-video-edit-workbench-action="toggle-snap"/);
  assert.match(node, /data-video-edit-workbench-action="add-subtitle"/);
  assert.match(node, /data-video-edit-toolbar-subtitle-input="true"/);
  assert.match(node, /const subtitleToolbarInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(node, /const subtitleTrackInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(node, /\(subtitleTrackInputRef\.current \|\| subtitleToolbarInputRef\.current\)\?\.focus\(\)/);
  assert.match(node, /data-video-edit-subtitle-inline-add="true"/);
  assert.ok(addSubtitleStart >= 0 && addSubtitleEnd > addSubtitleStart);
  assert.ok(addSubtitleBody.includes('rememberWorkbenchChange();'));
  assert.ok(addSubtitleBody.indexOf('rememberWorkbenchChange();') < addSubtitleBody.indexOf('update({ timelineV2: nextTimeline'));
  assert.ok(muteClipStart >= 0 && muteClipEnd > muteClipStart);
  assert.ok(muteClipBody.includes('rememberWorkbenchChange();'));
  assert.ok(muteClipBody.indexOf('rememberWorkbenchChange();') < muteClipBody.indexOf('patchClip('));
  assert.match(node, /const duplicateTimelineItems = \(baseIds: string\[\]\) =>/);
  assert.match(node, /duplicateSelectedTimelineItems/);
  assert.match(node, /duplicateTimelineItems\(\[itemId\]\)/);
  assert.match(node, /const patchVideoEditTimeline = \(/);
  assert.match(node, /rf\.setNodes\(\(nodes\) => nodes\.map/);
  assert.match(node, /if \(node\.id !== id\) return node/);
  assert.match(node, /const commitTimelinePlayhead = \(timelineTime: number, selectedItemId\?: string, selectedItemIdsOverride\?: string\[\]\) => \{/);
  assert.match(node, /const liveTimeline = normalizeVideoEditTimeline\(liveData\.timelineV2 as VideoEditTimelineV2 \| undefined, liveClips\)/);
  assert.match(node, /selectedItemIdsOverride \|\| \(selectedItemId \? \[selectedItemId\] : liveTimeline\.selectedItemIds\)/);
  assert.match(node, /const preserveNonVideoSelection = timelineV2\.selectedItemIds\.some/);
  assert.match(node, /commitTimelinePlayhead\(nextPlayhead, preserveNonVideoSelection \? undefined : timelinePlayback\.item\.id\)/);
  assert.match(node, /removeSelectedTimelineItems/);
  assert.match(node, /toggleTimelineSnap/);
  assert.match(node, /toggleTimelineItemMuted/);
  assert.match(node, /selectTimelineItemForWorkbench/);
  assert.match(node, /selectedTimelineItemIds/);
  assert.match(node, /selectedTimelineItemLabel/);
  assert.match(node, /selectedTimelineV2Item/);
  assert.match(node, /data-video-edit-timeline-audio-item-id=\{item\.sourceItemId\}[\s\S]*data-video-edit-timeline-item-selected=\{audioItemActive/);
  assert.match(node, /data-video-edit-timeline-audio-item-id=\{item\.sourceItemId\}[\s\S]*data-video-edit-timeline-item-move-source="pointer"[\s\S]*data-video-edit-timeline-item-action="mute"/);
  assert.match(node, /data-video-edit-timeline-text-item-id=\{item\.sourceItemId\}[\s\S]*data-video-edit-timeline-item-selected=\{textItemActive/);
  assert.match(node, /data-video-edit-timeline-text-item-id=\{item\.sourceItemId\}[\s\S]*data-video-edit-timeline-item-move-source="pointer"[\s\S]*data-video-edit-timeline-item-action="delete"/);
  assert.match(node, /const stopTimelineContextActionPointer = \(/);
  assert.match(node, /const handleTimelineContextActionClick = \(/);
  assert.match(node, /onPointerDown=\{stopTimelineContextActionPointer\}[\s\S]*onClick=\{\(event\) => handleTimelineContextActionClick\(event, 'duplicate'\)\}/);
  assert.doesNotMatch(node, /handleTimelineContextActionPointer\(event, 'duplicate'\)/);
  assert.doesNotMatch(node, /__t8VideoEdit/);
});

test('video edit full workbench supports modifier-click multi selection for timeline items', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const resolveWorkbenchTimelineSelectionMode = \(event\?: Pick<MouseEvent<HTMLElement>, 'ctrlKey' \| 'metaKey' \| 'shiftKey'>\)/);
  assert.match(node, /const buildWorkbenchTimelineSelection = \(itemId: string, mode: VideoEditTimelineControllerSelectMode/);
  assert.match(node, /ctrlKey \|\| event\.metaKey/);
  assert.match(node, /event\.shiftKey/);
  assert.match(node, /mode === 'toggle'/);
  assert.match(node, /mode === 'add'/);
  assert.match(node, /const sortWorkbenchTimelineItemsForRangeSelection = \(\)/);
  assert.match(node, /const buildWorkbenchTimelineRangeSelection = \(itemId: string\)/);
  assert.match(node, /timelineV2\.tracks\.map\(\(track\) => \[track\.id, track\.order\]\)/);
  assert.match(node, /\(trackOrderById\.get\(a\.trackId\) \?\? 999\) - \(trackOrderById\.get\(b\.trackId\) \?\? 999\)/);
  assert.match(node, /const rangeAnchorIds = timelineV2\.selectedItemIds\.length \? timelineV2\.selectedItemIds : activeTimelineItemId \? \[activeTimelineItemId\] : \[\]/);
  assert.match(node, /\[...rangeAnchorIds\]\.reverse\(\)\.find/);
  assert.match(node, /orderedItems\.slice\(from, to \+ 1\)\.map\(\(item\) => item\.id\)/);
  assert.match(node, /if \(mode === 'add'\) return buildWorkbenchTimelineRangeSelection\(itemId\)/);
  assert.match(node, /const selectTimelineVideoItem = \(item: VideoEditTimelineItem, mode: VideoEditTimelineControllerSelectMode = 'replace'\)/);
  assert.match(node, /const selectTimelineItemForWorkbench = \(item: VideoEditTimelineItem, mode: VideoEditTimelineControllerSelectMode = 'replace'\)/);
  assert.match(node, /selectionMode: VideoEditTimelineControllerSelectMode = 'replace'/);
  assert.match(node, /selectionMode: VideoEditTimelineControllerSelectMode;/);
  assert.match(node, /selectionMode,\s*changeRemembered: false/);
  assert.match(node, /if \(!drag\.changeRemembered\) \{[\s\S]{0,120}rememberWorkbenchChange\(\);[\s\S]{0,80}drag\.changeRemembered = true;/);
  assert.doesNotMatch(node, /selectTimelineItemForWorkbench\(item, selectionMode\);\s*rememberWorkbenchChange\(\);\s*timelineMoveDragRef\.current/);
  assert.match(node, /startTimelineItemMove\(event\.clientX, event\.currentTarget, event\.target, item, resolveWorkbenchTimelineSelectionMode\(event\), event\.pointerId\)/);
  assert.match(node, /startTimelineItemMove\(event\.clientX, event\.currentTarget, event\.target, item, resolveWorkbenchTimelineSelectionMode\(event\)\)/);
  assert.match(node, /commitTimelinePlayhead\(playback\.timelineTime, item\.id, selectedItemIds\)/);
  assert.match(node, /selectedItemIdsOverride \|\| \(selectedItemId \? \[selectedItemId\] : liveTimeline\.selectedItemIds\)/);
  assert.match(node, /onClick=\{\(event\) => \{ if \(shouldSuppressTimelineItemClick\(event\)\) return; selectTimelineVideoItem\(item, resolveWorkbenchTimelineSelectionMode\(event\)\); \}\}/);
  assert.match(node, /onClick=\{\(event\) => \{ if \(shouldSuppressTimelineItemClick\(event\)\) return; if \(sourceItem\) selectTimelineItemForWorkbench\(sourceItem, resolveWorkbenchTimelineSelectionMode\(event\)\); \}\}/);
  assert.match(node, /selectedTimelineItemCount > 1/);
  assert.match(node, /多选/);
});

test('video edit full workbench drags selected timeline items as one batch', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const moveStart = node.indexOf('const applyTimelineItemMoveClientX = (clientX: number) =>');
  const moveEnd = node.indexOf('const finishTimelineItemMove', moveStart);
  const moveBody = node.slice(moveStart, moveEnd);

  assert.ok(moveStart >= 0 && moveEnd > moveStart);

  assert.match(node, /const shouldMoveWorkbenchTimelineSelection = \(timeline: VideoEditTimelineV2, itemId: string\)/);
  assert.match(node, /const resolveWorkbenchTimelineLinkedMoveGroupIds = \(timeline: VideoEditTimelineV2, itemId: string\)/);
  assert.match(node, /const resolveWorkbenchTimelineBatchMoveItemIds = \(timeline: VideoEditTimelineV2, targetItemId: string, selectedItemIds: string\[\]\)/);
  assert.match(node, /const resolveWorkbenchTimelineMoveSelectedItemIds = \(timeline: VideoEditTimelineV2, itemId: string, mode: VideoEditTimelineControllerSelectMode\)/);
  assert.match(node, /const moveWorkbenchTimelineSelectedItems = \(/);
  assert.match(node, /timelineMoveClickSuppressUntilRef/);
  assert.match(node, /const shouldSuppressTimelineItemClick = \(event: MouseEvent<HTMLElement>\) =>/);
  assert.match(node, /timelineMoveClickSuppressUntilRef\.current = Date\.now\(\) \+ 350/);
  assert.match(node, /if \(shouldSuppressTimelineItemClick\(event\)\) return;[\s\S]{0,120}selectTimelineVideoItem\(item, resolveWorkbenchTimelineSelectionMode\(event\)\)/);
  assert.match(node, /if \(shouldSuppressTimelineItemClick\(event\)\) return;[\s\S]{0,120}if \(sourceItem\) selectTimelineItemForWorkbench\(sourceItem, resolveWorkbenchTimelineSelectionMode\(event\)\)/);
  assert.match(node, /const candidates = shouldMoveWorkbenchTimelineSelection\(timeline, targetItemId\)\s*\? \[targetItemId, \.\.\.selectedIds\.filter\(\(itemId\) => itemId !== targetItemId\)\]\s*: \[targetItemId\]/);
  assert.match(node, /const selectedItemIds = resolveWorkbenchTimelineMoveSelectedItemIds\(liveTimeline, drag\.itemId, drag\.selectionMode\)/);
  assert.match(node, /const moveItemIds = resolveWorkbenchTimelineBatchMoveItemIds\(liveTimeline, drag\.itemId, selectedItemIds\)/);
  assert.match(node, /moveItemIds\.slice\(1\)\.reduce/);
  assert.match(node, /moveVideoEditTimelineItem\(nextTimeline, itemId, \{ timelineStart: Math\.max\(0, item\.timelineStart \+ deltaSeconds\) \}, \{ snapThreshold: 0 \}\)/);
  assert.match(node, /shouldMoveWorkbenchTimelineSelection\(timeline, targetItemId\)/);
  assert.doesNotMatch(moveBody, /selectedItemIds:\s*\[drag\.itemId\]/);
});

test('video edit full workbench shows snap target feedback while dragging timeline items', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /resolveVideoEditTimelineSnap/);
  assert.match(node, /type VideoEditTimelineMovePreview = \{[\s\S]*snapActive: boolean/);
  assert.match(node, /const buildWorkbenchTimelineMoveExcludedIds = \(timeline: VideoEditTimelineV2, itemIds: string\[\]\)/);
  assert.match(node, /const buildWorkbenchTimelineMoveSnapPreview = \(/);
  assert.match(node, /setTimelineMovePreview\(\{[\s\S]*snapActive: snapDetail\.snapped/);
  assert.match(node, /snapKind: snapDetail\.kind/);
  assert.match(node, /snapDelta: snapDetail\.distance/);
  assert.match(node, /snapTargetLabel: snapDetail\.label/);
  assert.match(node, /data-video-edit-timeline-snap-active=\{timelineMovePreview\.snapActive \? 'true' : 'false'\}/);
  assert.match(node, /data-video-edit-timeline-snap-kind=\{timelineMovePreview\.snapKind\}/);
  assert.match(node, /data-video-edit-timeline-snap-delta=\{timelineMovePreview\.snapDelta\}/);
  assert.match(node, /data-video-edit-timeline-snap-target=\{timelineMovePreview\.snapTargetLabel\}/);
  assert.match(node, /data-video-edit-timeline-snap-guide="true"/);
});

test('video edit full workbench marquee-selects timeline items from the track background', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /type VideoEditTimelineMarqueeDrag = \{/);
  assert.match(node, /type VideoEditTimelineMarqueeSelection = \{/);
  assert.match(node, /const timelineMarqueeDragRef = useRef<VideoEditTimelineMarqueeDrag \| null>\(null\)/);
  assert.match(node, /const timelineMarqueeDocumentCleanupRef = useRef<\(\(\) => void\) \| null>\(null\)/);
  assert.match(node, /const \[timelineMarqueeSelection, setTimelineMarqueeSelection\] = useState<VideoEditTimelineMarqueeSelection>\(null\)/);
  assert.match(node, /const readWorkbenchTimelineMarqueeItemId = \(element: HTMLElement\) =>/);
  assert.match(node, /const resolveWorkbenchTimelineMarqueeItemIds = \(rect: DOMRect, container: HTMLElement, timeline: VideoEditTimelineV2\) =>/);
  assert.match(node, /querySelectorAll<HTMLElement>\('\[data-video-edit-timeline-item-move-source="pointer"\]'\)/);
  assert.match(node, /const beginWorkbenchTimelineMarqueeSelection = \(event: PointerEvent<HTMLElement>\) =>/);
  assert.match(node, /const applyWorkbenchTimelineMarqueeClientPoint = \(clientX: number, clientY: number\) =>/);
  assert.match(node, /const finishWorkbenchTimelineMarqueeSelection = \(/);
  assert.match(node, /const isWorkbenchTimelineMarqueeBlockedTarget = \(target: EventTarget \| null\) =>/);
  assert.match(node, /data-video-edit-timeline-marquee="true"/);
  assert.match(node, /data-video-edit-timeline-marquee-count=\{timelineMarqueeSelection\.itemIds\.length\}/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginWorkbenchTimelineMarqueeSelection\(event\)\}/);
  assert.match(node, /const selectedItemIds = resolveWorkbenchTimelineMarqueeItemIds/);
  assert.match(node, /selectedItemIds: nextSelectedItemIds/);
  assert.match(node, /mode === 'toggle'/);
  assert.match(node, /mode === 'add'/);
});

test('video edit full workbench applies batch properties to selected timeline items', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const selectedTimelineBatchPropertyCounts = useMemo/);
  assert.match(node, /const patchSelectedTimelineItemFields = \(/);
  assert.match(node, /const patchSelectedTimelineItemVolume = \(volume: number\)/);
  assert.match(node, /const patchSelectedTimelineItemMuted = \(muted: boolean\)/);
  assert.match(node, /const patchSelectedTimelineTextAssets = \(/);
  assert.match(node, /const patchSelectedTimelinePipFields = \(/);
  assert.match(node, /guardLockedTimelineItems\(guardTimeline, targetIds, '批量属性'\)/);
  assert.match(node, /rememberWorkbenchChange\(\);[\s\S]{0,240}patchVideoEditTimeline/);
  assert.match(node, /selectedTimelineItemCount > 1 && \(/);
  assert.match(node, /data-video-edit-batch-property-panel="true"/);
  assert.match(node, /data-video-edit-batch-property-selected-count=\{selectedTimelineItemCount\}/);
  assert.match(node, /data-video-edit-batch-property-media-count=\{selectedTimelineBatchPropertyCounts\.media\}/);
  assert.match(node, /data-video-edit-batch-property-text-count=\{selectedTimelineBatchPropertyCounts\.text\}/);
  assert.match(node, /data-video-edit-batch-property-pip-count=\{selectedTimelineBatchPropertyCounts\.pip\}/);
  assert.match(node, /data-video-edit-batch-property-action="volume-50"/);
  assert.match(node, /data-video-edit-batch-property-action="mute-selected"/);
  assert.match(node, /data-video-edit-batch-property-action="unmute-selected"/);
  assert.match(node, /data-video-edit-batch-property-action="subtitle-top"/);
  assert.match(node, /data-video-edit-batch-property-action="subtitle-yellow"/);
  assert.match(node, /data-video-edit-batch-property-action="subtitle-bg-light"/);
  assert.match(node, /data-video-edit-batch-property-action="pip-opacity-50"/);
  assert.match(node, /data-video-edit-batch-property-action="pip-scale-60"/);
});

test('video edit full workbench exposes detailed batch subtitle controls', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const selectedTimelineBatchSubtitleStyle = useMemo/);
  assert.match(node, /data-video-edit-batch-subtitle-detail="true"/);
  assert.match(node, /data-video-edit-batch-subtitle-count=\{selectedTimelineBatchPropertyCounts\.text\}/);
  assert.match(node, /data-video-edit-batch-subtitle-position-current=\{selectedTimelineBatchSubtitleStyle\.position\}/);
  assert.match(node, /data-video-edit-batch-subtitle-font-size-current=\{selectedTimelineBatchSubtitleStyle\.fontSize\}/);
  assert.match(node, /data-video-edit-batch-subtitle-color-current=\{selectedTimelineBatchSubtitleStyle\.color\}/);
  assert.match(node, /data-video-edit-batch-subtitle-background-current=\{selectedTimelineBatchSubtitleStyle\.background\}/);
  assert.match(node, /data-video-edit-batch-subtitle-position=\{option\.value\}/);
  assert.match(node, /data-video-edit-batch-subtitle-font-size="true"/);
  assert.match(node, /data-video-edit-batch-subtitle-color="true"/);
  assert.match(node, /data-video-edit-batch-subtitle-background="true"/);
  assert.match(node, /patchSelectedTimelineTextAssets\(\{ textFontSize: Number\(event\.target\.value\) \}\)/);
  assert.match(node, /patchSelectedTimelineTextAssets\(\{ textColor: event\.target\.value \}\)/);
  assert.match(node, /patchSelectedTimelineTextAssets\(\{ textBackground: event\.target\.value \}\)/);
});

test('video edit full workbench guards locked tracks across timeline edit entry points', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const isTimelineItemEditable = \(\s*timeline: VideoEditTimelineV2,\s*itemOrId: VideoEditTimelineItem \| string \| undefined,/);
  assert.match(node, /const getLiveTimelineGuardSnapshot = \(\) => \{/);
  assert.match(node, /const guardLockedTimelineItems = \(\s*timeline: VideoEditTimelineV2,\s*itemIds: string\[\],\s*actionLabel: string,/);
  assert.match(node, /锁定轨道内的条目不能\$\{actionLabel\}/);
  assert.match(node, /removeTimelineItems[\s\S]{0,500}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), itemIds, '删除'\)/);
  assert.match(node, /duplicateTimelineItems[\s\S]{0,500}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), baseIds, '复制'\)/);
  assert.match(node, /toggleTimelineItemMuted[\s\S]{0,260}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), \[itemId\], '静音\/取消静音'\)/);
  assert.match(node, /applyVideoEditTimelineBatchAction[\s\S]{0,2200}guardLockedTimelineItems\(guardTimeline, batchTargetIds, '批量处理'\)/);
  assert.match(node, /patchTimelineItemFields[\s\S]{0,260}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), \[itemId\], '调整'\)/);
  assert.match(node, /patchTimelineAssetFields[\s\S]{0,320}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), \[itemId\], '编辑'\)/);
  assert.match(node, /patchPreviewPipDragPosition[\s\S]{0,320}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), \[itemId\], '移动画中画'\)/);
  assert.match(node, /startPreviewPipDrag[\s\S]{0,500}guardLockedTimelineItems\(getLiveTimelineGuardSnapshot\(\), \[itemId\], '拖动画中画'\)/);
  assert.match(node, /splitTimelineItemAtPlayhead[\s\S]{0,640}guardLockedTimelineItems\(liveTimeline, \[itemId\], '拆分'\)/);
  assert.match(node, /locked: !!track\?\.locked/);
  assert.match(node, /selectedTimelineItemDetail\.locked/);
  assert.match(node, /const selectedTimelineItemsLocked = selectedTimelineItems\.some/);
  assert.match(node, /const selectedClipTimelineItem = selectedClip/);
  assert.match(node, /const selectedClipTimelineLocked = selectedClipTimelineItem/);
  assert.match(node, /const selectedTimelineDeleteLocked = selectedTimelineItemCount/);
  assert.match(node, /const isClipOnLockedTimelineTrack = \(clipId: string\) =>/);
  assert.match(node, /handleTrimStartChange[\s\S]{0,220}isClipOnLockedTimelineTrack\(clipId\)[\s\S]{0,180}该轨道已锁定/);
  assert.match(node, /handleTrimEndChange[\s\S]{0,220}isClipOnLockedTimelineTrack\(clipId\)[\s\S]{0,180}该轨道已锁定/);
  assert.match(node, /data-video-edit-workbench-action="split-at-playhead"[\s\S]{0,260}disabled=\{!selectedClip \|\| selectedClipTimelineLocked \|\| running \|\| !!busy\}/);
  assert.match(node, /data-video-edit-workbench-action="duplicate-selected"[\s\S]{0,260}disabled=\{!selectedTimelineItemCount \|\| selectedTimelineItemsLocked \|\| running \|\| !!busy\}/);
  assert.match(node, /data-video-edit-workbench-action="delete-selected"[\s\S]{0,300}disabled=\{\(!selectedTimelineItemCount && !selectedClip\) \|\| selectedTimelineDeleteLocked \|\| running \|\| !!busy\}/);
  assert.match(node, /handleTrimStartChange\(selectedClip\.id, Number\(event\.target\.value\)\)[\s\S]{0,140}disabled=\{running \|\| !!busy \|\| selectedClipTimelineLocked\}/);
  assert.match(node, /handleTrimEndChange\(selectedClip\.id, Number\(event\.target\.value\)\)[\s\S]{0,140}disabled=\{running \|\| !!busy \|\| selectedClipTimelineLocked\}/);
  assert.match(node, /const timelineContextMenuItemLocked = /);
  assert.match(node, /data-video-edit-timeline-context-menu[\s\S]{0,360}data-locked=\{timelineContextMenuItemLocked \? 'true' : 'false'\}/);
  assert.match(node, /data-video-edit-timeline-context-action="split"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| timelineContextMenuItemLocked\}/);
  assert.match(node, /data-video-edit-timeline-context-action="duplicate"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| timelineContextMenuItemLocked\}/);
  assert.match(node, /data-video-edit-timeline-context-action="mute"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| timelineContextMenuItemLocked \|\| timelineContextMenuItem\?\.kind === 'text'\}/);
  assert.match(node, /data-video-edit-timeline-context-action="delete"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| timelineContextMenuItemLocked\}/);
  assert.match(node, /data-video-edit-subtitle-quick-position=\{option\.value\}[\s\S]{0,420}disabled=\{running \|\| !!busy \|\| selectedTimelineItemDetail\.locked\}/);
});

test('video edit full workbench disables inline timeline controls on locked tracks', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const isTimelineItemLocked = \(item\?: VideoEditTimelineItem\) =>/);
  assert.match(node, /const disabled = running \|\| !!busy \|\| isTimelineItemLocked\(item\)/);
  assert.match(node, /data-video-edit-timeline-item-locked=\{mainItemLocked \? 'true' : undefined\}/);
  assert.match(node, /data-video-edit-clip-action="mute"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| mainItemLocked\}/);
  assert.match(node, /data-video-edit-clip-action="delete"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| mainItemLocked\}/);
  assert.match(node, /const overlayItemLocked = isTimelineItemLocked\(item\)/);
  assert.match(node, /data-video-edit-timeline-overlay-item-id=\{item\.id\}[\s\S]{0,420}data-video-edit-timeline-item-locked=\{overlayItemLocked \? 'true' : undefined\}/);
  assert.match(node, /data-video-edit-timeline-item-action="mute"[\s\S]{0,420}disabled=\{running \|\| !!busy \|\| overlayItemLocked\}/);
  assert.match(node, /data-video-edit-timeline-item-action="delete"[\s\S]{0,420}disabled=\{running \|\| !!busy \|\| overlayItemLocked\}/);
  assert.match(node, /const audioItemLocked = sourceItem \? isTimelineItemLocked\(sourceItem\) : true/);
  assert.match(node, /data-video-edit-timeline-audio-item-id=\{item\.sourceItemId\}[\s\S]{0,420}data-video-edit-timeline-item-locked=\{audioItemLocked \? 'true' : undefined\}/);
  assert.match(node, /disabled=\{!sourceItem \|\| running \|\| !!busy \|\| audioItemLocked\}/);
  assert.match(node, /const textItemLocked = sourceItem \? isTimelineItemLocked\(sourceItem\) : true/);
  assert.match(node, /data-video-edit-timeline-text-item-id=\{item\.sourceItemId\}[\s\S]{0,420}data-video-edit-timeline-item-locked=\{textItemLocked \? 'true' : undefined\}/);
  assert.match(node, /data-video-edit-timeline-item-action="delete"[\s\S]{0,360}disabled=\{running \|\| !!busy \|\| textItemLocked\}/);
});

test('video edit full workbench main track actions target timeline items instead of source clips', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const mainTrackStart = node.indexOf('key={`studio-video-${item.id}`}');
  const mainTrackEnd = node.indexOf('data-video-edit-track-kind="overlay"', mainTrackStart);
  const mainTrackBody = node.slice(mainTrackStart, mainTrackEnd);

  assert.ok(mainTrackStart >= 0 && mainTrackEnd > mainTrackStart);
  assert.match(mainTrackBody, /data-video-edit-timeline-item-action="mute"/);
  assert.match(mainTrackBody, /data-video-edit-timeline-item-action="delete"/);
  assert.match(mainTrackBody, /toggleTimelineItemMuted\(item\.id\)/);
  assert.match(mainTrackBody, /removeTimelineItems\(\[item\.id\]\)/);
  assert.doesNotMatch(mainTrackBody, /toggleClipMuted\(clip\.id\)/);
  assert.doesNotMatch(mainTrackBody, /removeClip\(clip\.id\)/);
});

test('video edit full workbench audio lane controls timeline audio items instead of source clips', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');
  const audioLaneStart = node.indexOf('data-video-edit-track-lane="audio"');
  const audioLaneEnd = node.indexOf('data-video-edit-track-lane="text"', audioLaneStart);
  const audioLaneBody = node.slice(audioLaneStart, audioLaneEnd);

  assert.match(node, /const toggleTimelineAudioLaneMuted = \(\) => \{/);
  assert.match(node, /const allTimelineAudioItemsMuted = /);
  assert.match(node, /timeline\.items[\s\S]{0,80}\.filter\(\(item\) => item\.kind === 'audio' && isTimelineItemEditable\(timeline, item\)\)/);
  assert.match(node, /track-audio-independent/);
  assert.ok(audioLaneStart >= 0 && audioLaneEnd > audioLaneStart);
  assert.match(audioLaneBody, /getVideoEditTimelineTracksByKind\('audio'\)\.map/);
  assert.match(audioLaneBody, /toggleTimelineAudioLaneMuted/);
  assert.doesNotMatch(audioLaneBody, /toggleAllClipMuted/);
});

test('video edit full workbench trims audio and subtitle timeline items from the shared track handles', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /splitVideoEditTimelineItem/);
  assert.match(node, /type VideoEditTimelineItemTrimDrag/);
  assert.match(node, /timelineItemTrimDragRef/);
  assert.match(node, /const beginTimelineItemTrimMove =/);
  assert.match(node, /const beginTimelineItemTrimMouseMove =/);
  assert.match(node, /const applyTimelineItemTrimClientX =/);
  assert.match(node, /resizeVideoEditTimelineItem\(liveTimeline, drag\.itemId, drag\.edge, nextSourceTime\)/);
  assert.match(node, /document\.addEventListener\('pointermove', handleTimelineItemTrimWindowPointerMove, \{ capture: true, passive: false \}\)/);
  assert.match(node, /document\.addEventListener\('mousemove', handleTimelineItemTrimWindowMouseMove, \{ capture: true, passive: false \}\)/);
  assert.match(node, /document\.removeEventListener\('pointermove', handleTimelineItemTrimWindowPointerMove, true\)/);
  assert.match(node, /document\.removeEventListener\('mousemove', handleTimelineItemTrimWindowMouseMove, true\)/);
  assert.match(node, /\[data-video-edit-track-item-trim-handle\]/);
  assert.match(node, /const renderTimelineItemTrimHandles =/);
  assert.match(node, /data-video-edit-track-item-trim-handle="start"/);
  assert.match(node, /data-video-edit-track-item-trim-handle="end"/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginTimelineItemTrimMove\(event, item, 'start'\)\}/);
  assert.match(node, /onPointerDownCapture=\{\(event\) => beginTimelineItemTrimMove\(event, item, 'end'\)\}/);
  assert.match(node, /onMouseDownCapture=\{\(event\) => beginTimelineItemTrimMouseMove\(event, item, 'start'\)\}/);
  assert.match(node, /onMouseDownCapture=\{\(event\) => beginTimelineItemTrimMouseMove\(event, item, 'end'\)\}/);
  assert.match(node, /data-video-edit-timeline-audio-item-id=\{item\.sourceItemId\}[\s\S]*renderTimelineItemTrimHandles\(sourceItem\)/);
  assert.match(node, /data-video-edit-timeline-text-item-id=\{item\.sourceItemId\}[\s\S]*renderTimelineItemTrimHandles\(sourceItem\)/);
});

test('video edit full workbench context split targets the clicked timeline item type', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const splitTimelineItemAtPlayhead = \(itemId: string\) =>/);
  assert.match(node, /splitVideoEditTimelineItem\(liveTimeline, itemId, splitAt\)/);
  assert.match(node, /if \(action === 'split'\) \{[\s\S]{0,180}splitTimelineItemAtPlayhead\(itemId\);[\s\S]{0,80}return;/);
  assert.doesNotMatch(node, /if \(action === 'split'\) \{[\s\S]{0,160}splitSelectedClipAtPlayhead\(\)/);
  assert.match(node, /const timelineContextMenuItem = timelineContextMenu \? timelineV2\.items\.find/);
  assert.match(node, /timelineContextMenuItem\?\.kind === 'audio'/);
  assert.match(node, /timelineContextMenuItem\?\.kind === 'text'/);
  assert.match(node, /left:\s*`clamp\(8px, \$\{timelineContextMenu\.x\}px, calc\(100vw - 190px\)\)`/);
  assert.match(node, /top:\s*`clamp\(8px, \$\{timelineContextMenu\.y\}px, calc\(100vh - 220px\)\)`/);
  assert.match(node, /data-video-edit-timeline-context-action="split"[\s\S]*拆分\{timelineContextKindLabel\}/);
  assert.match(node, /data-video-edit-timeline-context-action="mute"[\s\S]*disabled=\{running \|\| !!busy \|\| timelineContextMenuItemLocked \|\| timelineContextMenuItem\?\.kind === 'text'\}/);
});

test('video edit full workbench supports pointer timeline moving, context menu, and media insert modes', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /moveVideoEditTimelineItem/);
  assert.match(node, /type VideoEditTimelineMoveDrag/);
  assert.match(node, /timelineMoveDragRef/);
  assert.match(node, /beginTimelineItemMove/);
  assert.match(node, /beginTimelineItemMouseMove/);
  assert.match(node, /applyTimelineItemMoveClientX/);
  assert.match(node, /const resolveClipForTimelineItem =/);
  assert.match(node, /const resolveClipIdForTimelineItemId =/);
  assert.match(node, /const selectedClipId = resolveClipIdForTimelineItemId\(drag\.itemId, nextTimeline, liveClips\)/);
  assert.match(node, /\.\.\.\(selectedClipId \? \{ selectedClipId \} : \{\}\)/);
  assert.doesNotMatch(node, /selectedClipId:\s*drag\.itemId/);
  assert.doesNotMatch(node, /selectedClipId:\s*selectedItemId/);
  assert.match(node, /VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND/);
  assert.match(node, /workbenchTimelineVirtualWidth/);
  assert.match(node, /videoEditTimelineTimeToX\(item\.timelineStart/);
  assert.match(node, /absolute bottom-0 top-0 cursor-grab/);
  assert.match(node, /data-video-edit-timeline-item-move-source="pointer"/);
  assert.match(node, /data-video-edit-timeline-item-drag-preview="true"/);
  assert.match(node, /data-video-edit-timeline-context-menu="true"/);
  assert.match(node, /openTimelineContextMenu/);
  assert.match(node, /addClipToWorkbenchTimeline/);
  assert.match(node, /data-video-edit-media-action="append"/);
  assert.match(node, /data-video-edit-media-action="insert"/);
  assert.match(node, /data-video-edit-media-action="overwrite"/);
  assert.match(node, /insertVideoEditTimelineRange\(editedTimeline, insertStart, editDuration/);
  assert.match(node, /overwriteVideoEditTimelineRange\(editedTimeline, insertStart, editDuration/);
  assert.match(node, /targetTrackIds: \[\.\.\.overwriteTargetTrackIds\]/);
  assert.match(node, /type VideoEditWorkbenchInsertMode = 'append' \| 'insert' \| 'overwrite' \| 'overlay'/);
  assert.match(node, /data-video-edit-media-action="overlay"/);
  assert.match(node, /addClipToWorkbenchTimeline\(clip\.id, 'overlay'\)/);
  assert.match(node, /const workbenchOverlayTimelineItems = useMemo/);
  assert.match(node, /workbenchOverlayTimelineViewportRef/);
  assert.match(node, /data-video-edit-workbench-synced-scroll="overlay"/);
  assert.match(node, /track-video-overlay/);
  assert.match(node, /叠加视频轨/);
  assert.doesNotMatch(node, /running \|\| busy \|\| item\.kind !== 'video'/);
  assert.doesNotMatch(node, /draggable=\{!running && !busy\}/);
});

test('video edit full workbench exposes pip overlay preview and transform controls', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const VIDEO_EDIT_PIP_PRESETS = \[/);
  assert.match(node, /id: 'bottom-right'/);
  assert.match(node, /x: 96,\s*y: 92,\s*scale: 0\.34,\s*opacity: 1/);
  assert.match(node, /const activePreviewPipSegments = useMemo/);
  assert.match(node, /timelineRenderPlan\.clips\.filter/);
  assert.match(node, /item\.layerIndex > 0/);
  assert.match(node, /const previewOverlayVideoRefs = useRef<Record<string, HTMLVideoElement \| null>>/);
  assert.match(node, /const syncActivePreviewOverlayVideos =/);
  assert.match(node, /const previewOverlaySegmentSourceTime =/);
  assert.match(node, /data-video-edit-preview-pip-overlay="true"/);
  assert.match(node, /data-video-edit-preview-pip-video="true"/);
  assert.match(node, /data-video-edit-preview-pip-source-time=\{previewOverlaySegmentSourceTime\(segment\)\}/);
  assert.match(node, /onLoadedMetadata=\{\(\) => syncActivePreviewOverlayVideos\(\)\}/);
  assert.match(node, /data-video-edit-preview-pip-x=\{x\}/);
  assert.match(node, /data-video-edit-preview-pip-y=\{y\}/);
  assert.match(node, /data-video-edit-preview-pip-scale=\{scale\}/);
  assert.match(node, /data-video-edit-preview-pip-opacity=\{opacity\}/);
  assert.match(node, /type VideoEditPipDrag =/);
  assert.match(node, /const previewPipDragRef = useRef<VideoEditPipDrag \| null>\(null\)/);
  assert.match(node, /const patchPreviewPipDragPosition =/);
  assert.match(node, /const beginPreviewPipDrag =/);
  assert.match(node, /data-video-edit-pip-drag-handle="true"/);
  assert.match(node, /data-video-edit-pip-item-id=\{segment\.sourceItemId\}/);
  assert.match(node, /attachPreviewPipDragDocumentListeners\(\)/);
  assert.match(node, /setPointerCapture\(pointerId as number\)/);
  assert.doesNotMatch(node, /data-video-edit-preview-pip-overlay="true"[\s\S]{0,360}pointer-events-none/);
  assert.match(node, /data-video-edit-preview-subtitle="true"/);
  assert.match(node, /data-video-edit-preview-subtitle-position=\{position\}/);
  assert.match(node, /data-video-edit-preview-subtitle-font-size=\{subtitleFontSize\}/);
  assert.match(node, /data-video-edit-preview-subtitle-color=\{segment\.color \|\| '#ffffff'\}/);
  assert.match(node, /data-video-edit-preview-subtitle-background=\{segment\.background \|\| 'rgba\(0,0,0,0\.55\)'\}/);
  assert.match(node, /const subtitleFontSize = Math\.max\(12, Math\.min\(72, Math\.round\(Number\(segment\.fontSize\) \|\| 42\)\)\)/);
  assert.match(node, /fontSize:\s*`\$\{subtitleFontSize\}px`/);
  assert.match(node, /whiteSpace:\s*'pre-wrap'/);
  assert.match(node, /overflowWrap:\s*'anywhere'/);

  assert.match(node, /mode === 'overlay'/);
  assert.match(node, /track-video-overlay/);
  assert.match(node, /trackId:\s*videoTrack\.id,/);
  assert.match(node, /kind:\s*'video'/);
  assert.match(node, /x:\s*mode === 'overlay' \? 96 : 0/);
  assert.match(node, /y:\s*mode === 'overlay' \? 92 : 0/);
  assert.match(node, /scale:\s*mode === 'overlay' \? 0\.34 : 1/);
  assert.match(node, /opacity:\s*1/);

  assert.match(node, /data-video-edit-pip-controls="true"/);
  assert.match(node, /data-video-edit-timeline-overlay-item-id=\{item\.id\}/);
  assert.match(node, /data-video-edit-pip-preset="true"/);
  assert.match(node, /data-video-edit-pip-x="true"/);
  assert.match(node, /data-video-edit-pip-y="true"/);
  assert.match(node, /data-video-edit-pip-scale="true"/);
  assert.match(node, /data-video-edit-pip-opacity="true"/);
  assert.match(node, /data-video-edit-pip-reset="true"/);
  assert.match(node, /patchTimelineItemFields\(item\.id, \{\s*x: preset\.x,\s*y: preset\.y,\s*scale: preset\.scale,\s*opacity: preset\.opacity,/);
});

test('video edit workbench has a selected timeline item inspector for video audio and text items', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const selectedTimelineItemDetail = useMemo\(\(\) =>/);
  assert.match(node, /data-video-edit-selected-item-inspector="true"/);
  assert.match(node, /data-video-edit-selected-item-summary="true"/);
  assert.match(node, /data-video-edit-selected-summary-action="seek"/);
  assert.match(node, /data-video-edit-selected-summary-action="mute"/);
  assert.match(node, /data-video-edit-selected-summary-action="delete"/);
  assert.match(node, /data-video-edit-selected-quick-panel="true"/);
  const visibleQuickPanelIndex = node.indexOf('data-video-edit-selected-quick-panel="true"');
  const legacyQuickPanelIndex = node.indexOf('data-video-edit-selected-quick-panel-legacy="true"');
  assert.ok(visibleQuickPanelIndex > -1, 'visible selected quick panel should exist');
  assert.ok(legacyQuickPanelIndex > visibleQuickPanelIndex, 'legacy quick panel should remain after the visible panel');
  for (const marker of [
    'data-video-edit-subtitle-quick-controls="true"',
    'data-video-edit-audio-quick-controls="true"',
    'data-video-edit-pip-quick-controls="true"',
  ]) {
    const markerIndex = node.indexOf(marker);
    assert.ok(
      markerIndex > visibleQuickPanelIndex && markerIndex < legacyQuickPanelIndex,
      `${marker} should be available in the visible selected quick panel, not only the hidden legacy inspector`,
    );
  }
  assert.match(node, /data-video-edit-subtitle-quick-controls="true"/);
  assert.match(node, /data-video-edit-subtitle-quick-current-position=\{positionValue\}/);
  assert.match(node, /data-video-edit-subtitle-quick-current-font-size=\{Math\.round\(fontSizeValue\)\}/);
  assert.match(node, /data-video-edit-subtitle-quick-current-color=\{colorValue\}/);
  assert.match(node, /data-video-edit-subtitle-quick-current-background=\{backgroundValue\}/);
  assert.match(node, /data-video-edit-subtitle-quick-position=\{option\.value\}/);
  assert.match(node, /data-video-edit-subtitle-quick-font-size="true"/);
  assert.match(node, /data-video-edit-subtitle-quick-color="true"/);
  assert.match(node, /data-video-edit-subtitle-quick-background="true"/);
  assert.match(node, /data-video-edit-audio-quick-controls="true"/);
  assert.match(node, /data-video-edit-audio-quick-current-volume=\{selectedTimelineItemDetail\.volume\}/);
  assert.match(node, /data-video-edit-audio-quick-muted=\{selectedTimelineItemDetail\.muted \? 'true' : 'false'\}/);
  assert.match(node, /data-video-edit-audio-quick-volume=\{value\}/);
  assert.match(node, /data-video-edit-audio-quick-toggle-muted="true"/);
  assert.match(node, /data-video-edit-audio-quick-volume-slider="true"/);
  assert.match(node, /data-video-edit-pip-quick-controls="true"/);
  assert.match(node, /data-video-edit-pip-quick-current-x=\{clampVideoEditPipPercent\(selectedTimelineItemDetail\.item\.x\)\}/);
  assert.match(node, /data-video-edit-pip-quick-current-y=\{clampVideoEditPipPercent\(selectedTimelineItemDetail\.item\.y\)\}/);
  assert.match(node, /data-video-edit-pip-quick-current-scale=\{clampVideoEditPipScale\(selectedTimelineItemDetail\.item\.scale\)\}/);
  assert.match(node, /data-video-edit-pip-quick-current-opacity=\{clampVideoEditPipOpacity\(selectedTimelineItemDetail\.item\.opacity\)\}/);
  assert.match(node, /data-video-edit-pip-quick-preset=\{preset\.id\}/);
  assert.match(node, /data-video-edit-pip-quick-x="true"/);
  assert.match(node, /data-video-edit-pip-quick-y="true"/);
  assert.match(node, /data-video-edit-pip-quick-scale="true"/);
  assert.match(node, /data-video-edit-pip-quick-opacity="true"/);
  assert.match(node, /data-video-edit-video-quick-controls="true"/);
  assert.match(node, /data-video-edit-selected-item-kind=\{selectedTimelineItemDetail\?\.kind \|\| 'none'\}/);
  assert.match(node, /data-video-edit-selected-item-action="seek"/);
  assert.match(node, /data-video-edit-selected-item-action="split"/);
  assert.match(node, /data-video-edit-selected-item-action="duplicate"/);
  assert.match(node, /data-video-edit-selected-item-action="mute"/);
  assert.match(node, /data-video-edit-selected-item-action="delete"/);
  assert.match(node, /data-video-edit-selected-audio-controls="true"/);
  assert.match(node, /data-video-edit-selected-volume="true"/);
  assert.match(node, /patchTimelineItemVolume/);
  assert.match(node, /data-video-edit-subtitle-style-controls="true"/);
  assert.match(node, /data-video-edit-subtitle-text="true"/);
  assert.match(node, /data-video-edit-subtitle-position="true"/);
  assert.match(node, /data-video-edit-subtitle-font-size="true"/);
  assert.match(node, /data-video-edit-subtitle-color="true"/);
  assert.match(node, /patchTimelineAssetFields/);
  assert.match(node, /选中素材/);
  assert.match(node, /data-video-edit-selected-kind-chip="true"/);
  assert.match(node, /\{selectedTimelineItemDetail\.kindLabel\}/);
  assert.doesNotMatch(node, /style=\{videoEditMutedStyle\}>视频片段<\/span>\s*<span className="rounded-full border px-1\.5 py-0\.5" style=\{videoEditMutedStyle\}>独立音频<\/span>\s*<span className="rounded-full border px-1\.5 py-0\.5" style=\{videoEditMutedStyle\}>字幕文本<\/span>/);
});

test('video edit workbench feature audit buttons reveal the matching quick controls', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /const revealWorkbenchSelectedQuickPanel = \(\) =>/);
  assert.match(node, /querySelector<HTMLElement>\('\[data-video-edit-selected-quick-panel="true"\]'\)/);
  assert.match(node, /target\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(node, /const selectFirstWorkbenchTimelineItem = \(/);
  assert.match(node, /selectTimelineItemForWorkbench\(item\);[\s\S]{0,160}revealWorkbenchSelectedQuickPanel\(\);/);
  assert.match(node, /const focusWorkbenchSubtitleStyle = \(\) => selectFirstWorkbenchTimelineItem\([\s\S]{0,180}\(item\) => item\.kind === 'text'/);
  assert.match(node, /const focusWorkbenchAudioControls = \(\) => selectFirstWorkbenchTimelineItem\([\s\S]{0,260}\(item\) => item\.kind === 'audio'/);
  assert.match(node, /const focusWorkbenchPipControls = \(\) => selectFirstWorkbenchTimelineItem\([\s\S]{0,160}isWorkbenchOverlayTimelineItem\(item\)/);
  assert.match(node, /const handleWorkbenchFeatureAuditClick = \(key: string\) =>/);
  assert.match(node, /if \(key === 'subtitle-style'\) \{[\s\S]{0,80}focusWorkbenchSubtitleStyle\(\);/);
  assert.match(node, /if \(key === 'audio-flow'\) \{[\s\S]{0,80}focusWorkbenchAudioControls\(\);/);
  assert.match(node, /if \(key === 'pip-flow'\) \{[\s\S]{0,80}focusWorkbenchPipControls\(\);/);
  assert.match(node, /handleWorkbenchFeatureAuditClick\(item\.key\);/);
  assert.match(node, /data-video-edit-selected-quick-panel="true"[\s\S]{0,160}tabIndex=\{-1\}/);
  assert.doesNotMatch(node, /if \(item\.key === 'subtitle-style'\) \{\s*if \(subtitleSegmentCount > 0\) focusWorkbenchZone\('inspector-right'\)/);
  assert.doesNotMatch(node, /if \(item\.key === 'pip-flow'\) focusWorkbenchMediaBin\(\);/);
});

test('video edit workbench media bin can search filter sources and show used clips', () => {
  const node = read('src/components/nodes/VideoEditNode.tsx');

  assert.match(node, /workbenchClipSearch/);
  assert.match(node, /setWorkbenchClipSearch/);
  assert.match(node, /workbenchClipSourceFilter/);
  assert.match(node, /setWorkbenchClipSourceFilter/);
  assert.match(node, /workbenchFilteredClips/);
  assert.match(node, /workbenchUsedClipIds/);
  assert.match(node, /data-video-edit-media-search="true"/);
  assert.match(node, /data-video-edit-media-source-filter="true"/);
  assert.match(node, /data-video-edit-media-used-badge="true"/);
  assert.match(node, /全部来源/);
  assert.match(node, /本地上传/);
  assert.match(node, /上游导入/);
  assert.match(node, /生成结果/);
  assert.match(node, /已用/);
});
