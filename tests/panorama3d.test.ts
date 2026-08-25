import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PANORAMA_CAMERA_VIEW_LIMIT,
  PANORAMA_AVATAR_LIMIT,
  PANORAMA_AVATAR_KEYFRAME_LIMIT,
  PANORAMA_KEYFRAME_SEQUENCE_DEFAULT,
  PANORAMA_OCCLUSION_MASK_LIMIT,
  PANORAMA_FIXED_PROMPT,
  PANORAMA_RATIO_OPTIONS,
  PANORAMA_RATIO_PRESETS,
  PANORAMA_SHOT_CAMERA_DEFAULT,
  PANORAMA_ACTION_PLAN_SCHEMA,
  PANORAMA_AVATAR_POSES,
  PANORAMA_ACTION_TERMS,
  buildPanoramaActionPlannerSystemPrompt,
  buildPanoramaActionPlannerUserPrompt,
  buildPanoramaAvatarSequenceFrames,
  buildPanoramaKeyframePrompt,
  buildPanoramaOcclusionPrompt,
  buildPanoramaShotCameraPrompt,
  buildPanoramaLocalActionPlan,
  buildPanoramaScenePrompt,
  buildPanoramaSceneSnapshot,
  buildPanoramaImageRequest,
  buildPanoramaCameraContextPrompt,
  buildPanoramaPromptFinal,
  classifyPanoramaSeamScore,
  deletePanoramaCameraView,
  deletePanoramaHotspot,
  isLikelyPanoramaImage,
  markPanoramaDefaultCameraView,
  inferPanoramaAvatarPoseFromText,
  panoramaAvatarPoseDefaultParams,
  panoramaAvatarPoseRootDefaults,
  panoramaRenderSize,
  prependPanoramaHistory,
  projectPanoramaHotspot,
  projectPanoramaAvatar,
  projectPanoramaShotTarget,
  resolvePanoramaRatio,
  parsePanoramaActionPlanJson,
  sanitizePanoramaAvatarKeyframes,
  sanitizePanoramaActionPlan,
  sanitizePanoramaAvatars,
  sanitizePanoramaCameraViews,
  sanitizePanoramaOcclusionMasks,
  sanitizePanoramaSequenceFrameCount,
  sanitizePanoramaShotCamera,
  screenPointToPanoramaAngles,
  updatePanoramaAvatar,
  updatePanoramaHotspot,
  upsertPanoramaAvatarKeyframe,
  upsertPanoramaAvatar,
  upsertPanoramaCameraView,
  upsertPanoramaHotspot,
  upsertPanoramaOcclusionMask,
  validatePanoramaGeneration,
} from '../src/utils/panorama3d.ts';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';
import { enUS, zhCN } from '../src/i18n/resources.ts';

test('panorama 3d node is registered under the 3D category', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const types = readFileSync(new URL('../src/types/canvas.ts', import.meta.url), 'utf8');
  const placement = readFileSync(new URL('../src/utils/nodePlacement.ts', import.meta.url), 'utf8');

  assertProductionNodeSchema('panorama-3d', {
    label: '3D全景',
    category: '3d',
    inputs: ['image'],
    outputs: ['image'],
    executable: true,
  });
  assert.match(registry, /'3d':\s*\{\s*label:\s*'3D'/);
  assert.match(types, /\|\s*'panorama-3d'/);
  assert.match(types, /\|\s*'3d'/);
  assert.match(placement, /'panorama-3d':\s*\{\s*w:\s*1180,\s*h:\s*760\s*\}/);
});

test('panorama 3d node uses bundled three dependency instead of importing public assets', () => {
  const source = readFileSync(new URL('../src/components/nodes/Panorama3DNode.tsx', import.meta.url), 'utf8');

  assert.match(source, /import\('three'\)/);
  assert.doesNotMatch(source, /\/vendor\/js\/three/);
  assert.doesNotMatch(source, /@vite-ignore/);
  assert.match(source, /if \(!autoRotate \|\| textureStatus !== 'ready'\)/);
});

test('panorama 3d node exposes built-in generation and resource actions', () => {
  const source = readFileSync(new URL('../src/components/nodes/Panorama3DNode.tsx', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');

  assert.match(source, /submitImageAsync/);
  assert.match(source, /queryImageStatus\(taskId,\s*'gpt-image-2'\)/);
  assert.match(source, /PANORAMA_FIXED_PROMPT/);
  assert.match(source, /useTranslation/);
  assert.match(source, /panoramaT\(`panelModes\.\$\{mode\}`\)/);
  assert.equal(zhCN.nodes.panorama3D.editor.panelModes.preview, '连接预览');
  assert.equal(enUS.nodes.panorama3D.editor.panelModes.preview, 'Connected preview');
  assert.match(source, /panoramaSourceUrl:\s*url/);
  assert.match(source, /panoramaGeneratedUrl:\s*url/);
  assert.match(source, /imageUrls:\s*\[url\]/);
  assert.match(source, /addResourceItem/);
  assert.match(source, /getResourceCategories\('panorama'\)/);
  assert.match(source, /kind:\s*'panorama'/);
  assert.match(source, /estimatePanoramaImageQuality/);
  assert.match(source, /panoramaViewerPosition/);
  assert.match(source, /panoramaViewCenter/);
  assert.match(source, /panoramaCameraViews/);
  assert.match(source, /panoramaHotspots/);
  assert.match(source, /panoramaAvatars/);
  assert.match(source, /panoramaAvatarKeyframes/);
  assert.match(source, /panoramaKeyframeSequenceCount/);
  assert.match(source, /panoramaOcclusionMasks/);
  assert.match(source, /panoramaControlSnapshotUrl/);
  assert.match(source, /panoramaActionPrompt/);
  assert.match(source, /panoramaActionPlan/);
  assert.match(source, /panoramaSceneSnapshot/);
  assert.match(source, /panoramaShotCamera/);
  assert.match(source, /buildPanoramaLocalActionPlan/);
  assert.match(source, /buildPanoramaActionPlannerSystemPrompt/);
  assert.match(source, /parsePanoramaActionPlanJson/);
  assert.match(source, /generateLlm/);
  assert.match(source, /panoramaT\('actionGeneration'\)/);
  assert.match(source, /panoramaT\('localParse'\)/);
  assert.match(source, /panoramaT\('aiParse'\)/);
  assert.match(source, /panoramaT\('applyCurrent'\)/);
  const leftCameraPanelIndex = source.indexOf("panoramaT('cameraAndTour')");
  const normalActionPanelIndex = source.indexOf('{renderActionPlannerPanel(false)}');
  const rightRolePanelIndex = source.indexOf('<div className="nodrag nowheel min-w-0 space-y-2"');
  assert.ok(leftCameraPanelIndex >= 0);
  assert.ok(normalActionPanelIndex > leftCameraPanelIndex);
  assert.ok(rightRolePanelIndex > normalActionPanelIndex);
  assert.equal(source.indexOf('{renderActionPlannerPanel(false)}', normalActionPanelIndex + 1), -1);
  assert.match(source, /hotspotPickMode/);
  assert.match(source, /screenPointToPanoramaAngles/);
  assert.match(source, /projectPanoramaHotspot/);
  assert.match(source, /viewRef\.current = sanitizePanoramaViewAngles/);
  assert.match(source, /const qualityLabel = quality \? panoramaT/);
  assert.match(source, /const qualityAspectLabel =/);
  assert.match(source, /quality\.seamScore/);
  assert.match(source, /const joint = new THREE\.Group\(\)/);
  assert.match(source, /const lowerJoint = new THREE\.Group\(\)/);
  assert.match(source, /lowerJoint\.name = `\$\{name\}Lower`/);
  assert.match(source, /upper\.position\.y = -upperLength \/ 2/);
  assert.match(source, /lower\.position\.y = -lowerLength \/ 2/);
  assert.match(source, /endControl\.name = `\$\{endName\}-control`/);
  assert.match(source, /head-control/);
  assert.match(source, /pelvis-control/);
  assert.match(source, /AvatarIkDragState/);
  assert.match(source, /collectAvatarIkControls/);
  assert.match(source, /avatarIkEditMode/);
  assert.match(source, /panoramaAvatarIkEditMode/);
  assert.match(source, /projectThreeObjectToCanvas/);
  assert.match(source, /startAvatarIkDrag/);
  assert.match(source, /moveAvatarIkDrag/);
  assert.match(source, /endAvatarIkDrag/);
  assert.match(source, /shoulderL/);
  assert.match(source, /elbowL/);
  assert.match(source, /kneeR/);
  assert.match(source, /panoramaT\('dragJointTitle'/);
  assert.match(source, /armLBendOffsetZ/);
  assert.match(source, /armLOffsetZ/);
  assert.match(source, /legRBendOffsetZ/);
  assert.match(source, /legROffsetZ/);
  assert.match(source, /applyAvatarPose\(mesh, avatar\.poseId, avatar\.poseParams\)/);
  assert.doesNotMatch(source, /name = 'shoulder'/);
  assert.doesNotMatch(source, /name = 'hip'/);
  assert.match(source, /panoramaAvatarPoseRootDefaults/);
  assert.match(source, /safePanoramaAvatarGroundMode/);
  assert.match(source, /AvatarRotateState/);
  assert.match(source, /startAvatarRotate/);
  assert.match(source, /moveAvatarRotate/);
  assert.match(source, /rootPitch:\s*target\.rootPitch/);
  assert.match(source, /panoramaT\('rotateAvatarTitle'/);
  assert.match(source, /panoramaT\('moveAvatarTitle'/);
  assert.match(source, /selectAvatarAtIndex/);
  assert.match(source, /focusAvatar\(item\)/);
  assert.match(source, /projectPanoramaShotTarget/);
  assert.match(source, /patchShotCamera/);
  assert.match(source, /applyDirectorShotView/);
  assert.match(source, /panoramaT\('directorShot'\)/);
  assert.match(source, /panoramaT\('openDirectorTitle'\)/);
  assert.match(source, /panoramaT\('advancedPosePosition'\)/);
  assert.match(source, /PANORAMA_DIRECTOR_SHORTCUTS/);
  assert.match(source, /createPortal/);
  assert.match(source, /Maximize2/);
  assert.match(source, /HelpCircle/);
  assert.match(source, /width:\s*1180/);
  assert.match(source, /grid-cols-\[minmax\(0,760px\)_360px\]/);
  assert.match(source, /mt-2 flex flex-col gap-2/);
  assert.match(source, /order-\[-40\] grid grid-cols-4 gap-1\.5/);
  assert.match(source, /order-\[-30\][\s\S]*panoramaT\('currentAvatarSummary'/);
  assert.match(source, /order-\[-20\] space-y-2/);
  assert.match(source, /order-\[-10\] grid grid-cols-\[1fr_1fr_auto_auto\]/);
  assert.match(source, /className="nodrag nowheel min-w-0 space-y-2" onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(source, /style=\{\{\s*maxHeight:\s*760\s*\}\}/);
  assert.doesNotMatch(source, /panoramaAvatarPanelOpen/);
  assert.match(source, /<section className="order-\[-10\] rounded-md border border-amber-300\/35 bg-amber-400\/10 p-2">[\s\S]*panoramaT\('directorShot'\)/);
  assert.match(source, /<section className="rounded-md border border-\[var\(--t8-border\)\] bg-\[var\(--t8-bg-panel\)\] p-2">[\s\S]*panoramaT\('actionTimeline'\)/);
  assert.match(source, /<section className="rounded-md border border-sky-300\/35 bg-sky-400\/10 p-2">[\s\S]*panoramaT\('occlusionReference'\)/);
  assert.match(source, /<section className="rounded-lg border border-\[var\(--t8-border\)\] bg-\[var\(--t8-bg-panel-muted\)\] p-2">[\s\S]*panoramaT\('cameraAndTour'\)/);
  assert.match(source, /placeholder=\{panoramaT\('hotspotNamePlaceholder'\)\}/);
  assert.match(source, /panoramaT\('pickHotspotTitle'\)/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_28px_28px\]/);
  assert.match(source, /bg-\[var\(--t8-accent\)\]/);
  assert.match(source, /text-\[var\(--t8-accent-text\)\]/);
  assert.match(source, /setDirectorFullscreenOpen/);
  assert.match(source, /isEditableShortcutTarget/);
  assert.match(source, /window\.addEventListener\('keydown', handleKeyDown, true\)/);
  assert.match(source, /directorPreviewUrl/);
  assert.match(source, /renderControlSnapshotDataUrl/);
  assert.match(source, /renderSceneSequenceSnapshots/);
  assert.match(source, /buildPanoramaAvatarSequenceFrames/);
  assert.match(source, /avatarsRef\.current = frameAvatars;\s*updateAvatarMeshes\(\);\s*if \(!drawFrame\(\)\) continue;/);
  assert.match(source, /sequenceLabel/);
  assert.match(source, /panoramaT\('exportSceneSnapshotTitle'\)/);
  assert.match(zhCN.nodes.panorama3D.editor.exportSceneSnapshotTitle, /F01-Fxx/);
  assert.match(source, /keyframeSequenceDraft/);
  assert.match(source, /PANORAMA_KEYFRAME_SEQUENCE_MAX/);
  assert.match(source, /onBlur=\{commitKeyframeSequenceDraft\}/);
  assert.match(source, /syncSequenceMaterialSet/);
  assert.match(source, /materialSetItemsToData\('image', items\)/);
  assert.match(source, /panoramaSequenceAutoManaged:\s*true/);
  assert.match(source, /defaultMode:\s*hasSequence \? 'material-set' : 'upload'/);
  assert.doesNotMatch(source, /imageUrls:\s*\[imageUrl,\s*\.{3}sequenceUrls\]/);
  assert.match(source, /drawOcclusionMaskOverlay/);
  assert.match(source, /startOcclusionMaskDrag/);
  assert.match(source, /moveOcclusionMaskDrag/);
  assert.match(source, /repeating-linear-gradient/);
  assert.match(source, /nowheel/);
  assert.match(source, /exportControlSnapshot/);
  assert.match(source, /panoramaT\('actionTimeline'\)/);
  assert.match(source, /panoramaT\('occlusionReference'\)/);
  assert.match(source, /panoramaT\('sequenceFrames'\)/);
  assert.match(source, /panoramaT\('joints'\)/);
  assert.match(source, /requestPanoramaRun\('control-snapshot'\)/);
  assert.match(source, /PANORAMA_SHOT_PRESETS/);
  assert.match(source, /panoramaT\('bodyPart'\)/);
  assert.match(source, /panoramaAvatarPoseDefaultParams/);
  assert.match(source, /panoramaT\('poseParams\.leftUpperArm'\)/);
  assert.match(source, /panoramaT\('poseParams\.rightThigh'\)/);
  assert.match(source, /faceMode:\s*'heading'/);
  assert.match(source, /nodrag nopan/);
  assert.match(source, /touchAction:\s*'none'/);
  assert.match(source, /panoramaAvatarPoseRootDefaults\(poseId\)/);
  assert.match(source, /panoramaAvatarPoseDefaultParams\(poseId\)/);
  assert.match(source, /resolvedPoseParams/);
  assert.match(source, /setLimb\(group,\s*'armR',\s*2\.34,\s*-0\.04,\s*0\.34/);
  assert.match(source, /setLimb\(group,\s*'armR',\s*1\.34/);
  assert.match(source, /setLimb\(group,\s*'legL',\s*-0\.04/);
  assert.match(source, /setLimb\(group,\s*'legR',\s*0\.04/);
  assert.match(source, /setLimb\(group,\s*'legL',\s*-0\.18,\s*-0\.04,\s*-0\.14\)/);
  assert.match(source, /setLimb\(group,\s*'legR',\s*0\.2,\s*0\.04,\s*0\.14\)/);
  assert.match(source, /setLimb\(group,\s*'legL',\s*-0\.38,\s*-0\.12,\s*-0\.58\)/);
  assert.match(source, /setLimb\(group,\s*'legR',\s*0\.38,\s*-0\.12,\s*0\.58\)/);
  assert.match(source, /setLimb\(group,\s*'legL',\s*-0\.2,\s*-0\.04,\s*-0\.08\)/);
  assert.match(source, /setLimb\(group,\s*'legR',\s*0\.26,\s*0\.04,\s*0\.08\)/);
  assert.doesNotMatch(source, /setLimb\(group,\s*'legL',\s*-0\.38,\s*-0\.12,\s*0\.72\)/);
  assert.doesNotMatch(source, /setLimb\(group,\s*'legR',\s*0\.38,\s*-0\.12,\s*-0\.72\)/);
  assert.match(source, /directorStageRef/);
  assert.match(source, /directorPreviewWrapRef/);
  assert.match(source, /startAvatarDrag\(event, item, 'director'\)/);
  assert.match(source, /avatarIkTrackedObjectName/);
  assert.match(source, /scorePoseParams/);
  assert.match(source, /handleStagePointerMove/);
  assert.match(source, /handleStagePointerEnd/);
  assert.match(source, /previewStageRef/);
  assert.match(source, /getInteractionElement/);
  assert.match(source, /getAvatarIkControlAtPointer/);
  assert.match(source, /getInteractionSurfaceAtPointer/);
  assert.match(source, /handleInteractionStagePointerDownCapture/);
  assert.match(source, /setPointerCaptureSafe/);
  assert.match(source, /releasePointerCaptureSafe/);
  assert.match(source, /onMouseDown=\{stopPanoramaMouseDown\}/);
  assert.match(source, /data-panorama-ik-control="true"/);
  assert.match(source, /onPointerDownCapture=\{\(event\) => handleInteractionStagePointerDownCapture\(event, 'node'\)\}/);
  assert.match(source, /window\.addEventListener\('pointerdown', handleWindowPointerDown/);
  assert.match(source, /window\.addEventListener\('pointermove', handleWindowPointerMove/);
  assert.match(source, /PANORAMA_FLOATING_ICON_BUTTON_STYLE/);
  assert.match(source, /PANORAMA_MOVE_HANDLE_STYLE/);
  assert.match(source, /PANORAMA_ROTATE_HANDLE_STYLE/);
  assert.match(source, /style=\{PANORAMA_FLOATING_ICON_BUTTON_STYLE\}/);
  assert.match(source, /style=\{\{\s*\.\.\.PANORAMA_MOVE_HANDLE_STYLE,\s*touchAction:\s*'none'\s*\}\}/);
  assert.match(source, /style=\{\{\s*\.\.\.PANORAMA_ROTATE_HANDLE_STYLE,\s*touchAction:\s*'none'\s*\}\}/);
  assert.match(source, /getAvatarToolDockStyle/);
  assert.match(source, /pos\.x > 88/);
  assert.match(source, /translateY\(-50%\)/);
  assert.match(source, /style=\{getAvatarToolDockStyle\(item, pos, 'node'\)\}/);
  assert.match(source, /style=\{getAvatarToolDockStyle\(item, pos, 'director'\)\}/);
  assert.match(source, /absolute z-\[70\] flex flex-col gap-1\.5/);
  assert.match(source, /absolute z-\[70\] flex flex-col gap-2/);
  assert.match(source, /startAvatarIkDrag\(event, control, 'director'\)/);
  assert.match(source, /startOcclusionMaskDrag\(event, mask, 'move', 'director'\)/);
  assert.match(source, /OCCLUSION_MASK_LABEL_CLASS/);
  assert.match(source, /bg-amber-100 px-2 py-1 text-\[10px\] font-black text-slate-950/);
  assert.match(source, /backgroundColor:\s*'#fef3c7'/);
  assert.match(source, /activeOcclusionMaskId/);
  assert.match(source, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(source, /removeOcclusionMask\(activeMask\)/);
  assert.match(source, /removeAvatar\(activeAvatar\)/);
  assert.match(source, /panoramaT\('rootPitchValue'/);
  assert.match(source, /panoramaT\('rootRollValue'/);
  assert.match(source, /translate\('nodes:panorama3D\.title'\)/);
  assert.match(source, /generatedSourceUrl \|\| connectedSourceUrl \? 'preview' : 'text'/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaRatio:\s*'ultrawide'/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaGenerationMode:\s*'text'/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaSizeLevel:\s*'1K'/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaViewerPosition:\s*''/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaViewCenter:\s*''/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaCameraViews:\s*\[\]/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaHotspots:\s*\[\]/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaAvatars:\s*\[\]/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaAvatarKeyframes:\s*\[\]/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaKeyframeSequenceCount:\s*8/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaOcclusionMasks:\s*\[\]/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaControlSnapshotUrl:\s*''/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaActionPrompt:\s*''/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaActionPlan:\s*null/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaSceneSnapshot:\s*null/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaAvatarIkEditMode:\s*false/);
  assert.match(canvas, /'panorama-3d':\s*\{[\s\S]*panoramaShotCamera:\s*\{/);
});

test('panorama storyboard prompt board defaults closed and stitches text below snapshots', async () => {
  const source = readFileSync(new URL('../src/components/nodes/Panorama3DNode.tsx', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');
  const farmCss = readFileSync(new URL('../src/styles/theme-farm-story.css', import.meta.url), 'utf8');
  const utilsSource = readFileSync(new URL('../src/utils/panorama3d.ts', import.meta.url), 'utf8');
  const utils = await import('../src/utils/panorama3d.ts');

  assert.equal(
    (utils as any).PANORAMA_STORYBOARD_PROMPT_DEFAULT,
    '｛［人物］是@在做［动作］，｝',
  );
  assert.equal(typeof (utils as any).normalizePanoramaStoryboardPrompt, 'function');
  assert.equal(typeof (utils as any).measurePanoramaStoryboardPromptPanel, 'function');
  assert.equal(typeof (utils as any).composePanoramaStoryboardPromptDataUrl, 'function');

  const normalize = (utils as any).normalizePanoramaStoryboardPrompt as (value: unknown) => string;
  const measure = (utils as any).measurePanoramaStoryboardPromptPanel as (value: string, width: number) => { lines: string[]; panelHeight: number };
  assert.equal(normalize('   '), '｛［人物］是@在做［动作］，｝');
  assert.equal(normalize('第一行\n'), '第一行\n');
  assert.equal(normalize('第一行\n第二行'), '第一行\n第二行');
  const single = measure('角色走进庭院', 1280);
  const multi = measure('第一行\n第二行\n第三行\n第四行', 1280);
  const wrapped = measure('这是一段非常长的分镜提示词，用来确认黑底白字提示词框会根据内容自动换行并增加高度，避免最终合成图被截断。', 420);
  assert.ok(multi.panelHeight > single.panelHeight);
  assert.ok(wrapped.lines.length > 1);

  assert.match(canvas, /panoramaStoryboardPromptEnabled:\s*false/);
  assert.match(canvas, /panoramaStoryboardPromptText:\s*'｛［人物］是@在做［动作］，｝'/);
  assert.match(source, /panoramaT\('storyboardPromptBoard'\)/);
  assert.equal(zhCN.nodes.panorama3D.editor.storyboardPromptBoard, '分镜提示板');
  assert.equal(enUS.nodes.panorama3D.editor.storyboardPromptBoard, 'Storyboard prompt board');
  assert.match(source, /panoramaStoryboardPromptEnabled/);
  assert.match(source, /panoramaStoryboardPromptText/);
  assert.match(source, /composePanoramaStoryboardPromptDataUrl/);
  assert.match(source, /renderStoryboardPromptPreview/);
  assert.match(source, /rawPreviewUrl/);
  assert.doesNotMatch(source, /const fallbackPreviewUrl = rawPreviewUrl \|\| storyboardPromptLivePreviewUrl/);
  assert.doesNotMatch(source, /previewHasComposedPrompt/);
  assert.match(source, /const previewFontSize = 15/);
  assert.match(source, /t8-panorama-storyboard-preview-caption/);
  assert.match(source, /t8-panorama-storyboard-preview-caption-line/);
  assert.match(source, /data-panorama-storyboard-preview="true"/);
  assert.match(source, /data-panorama-storyboard-preview-caption="true"/);
  assert.match(source, /data-panorama-storyboard-preview-line="true"/);
  assert.match(source, /data-panorama-storyboard-preview-placeholder="true"/);
  assert.match(source, /data-panorama-storyboard-preview-day-safe="true"/);
  assert.match(source, /data-panorama-storyboard-preview-tone="locked-white"/);
  assert.match(source, /data-panorama-storyboard-preview-safe-color="white"/);
  assert.match(source, /data-panorama-storyboard-preview-contrast-lock="true"/);
  assert.match(source, /data-panorama-storyboard-live-preview-text="white"/);
  assert.ok((source.match(/data-panorama-storyboard-live-preview-text="white"/g) || []).length >= 2);
  assert.match(source, /data-t8-color-lock="panorama-storyboard-preview"/);
  assert.ok((source.match(/data-t8-color-lock="panorama-storyboard-preview"/g) || []).length >= 4);
  assert.ok((source.match(/data-panorama-storyboard-preview-contrast-lock="true"/g) || []).length >= 4);
  assert.match(source, /lockPanoramaStoryboardPreviewTextElement/);
  assert.match(source, /style\.setProperty\('color', '#ffffff', 'important'\)/);
  assert.match(source, /style\.setProperty\('-webkit-text-fill-color', '#ffffff', 'important'\)/);
  assert.match(source, /style\.setProperty\('paint-order', 'stroke fill', 'important'\)/);
  assert.match(source, /style\.setProperty\('text-shadow', STORYBOARD_PREVIEW_READABLE_TEXT_SHADOW, 'important'\)/);
  assert.match(source, /const storyboardPromptPreviewRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(source, /lockPanoramaStoryboardPreviewTextTree/);
  assert.match(source, /querySelectorAll<HTMLElement>\('\[data-t8-color-lock="panorama-storyboard-preview"\], \[data-panorama-storyboard-preview-contrast-lock="true"\], \[data-panorama-storyboard-live-preview-text="white"\]'\)/);
  assert.match(source, /storyboardPromptPreviewRef\.current/);
  assert.match(source, /lockPanoramaStoryboardPreviewTextTree\(storyboardPromptPreviewRef\.current\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => lockPanoramaStoryboardPreviewTextTree\(storyboardPromptPreviewRef\.current\)\)/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /attributeFilter:\s*\['data-theme-mode', 'data-theme-visual', 'class', 'style'\]/);
  assert.match(source, /storyboardPromptPreviewRef\.current = element/);
  assert.match(source, /ref=\{lockPanoramaStoryboardPreviewTextElement\}/);
  assert.match(source, /backgroundColor:\s*'#050505'/);
  assert.match(source, /WebkitTextFillColor:\s*'#ffffff'/);
  assert.match(source, /WebkitTextStroke:\s*'0\.22px rgba\(255,\s*255,\s*255,\s*\.76\)'/);
  assert.match(source, /forcedColorAdjust:\s*'none'/);
  assert.match(source, /colorScheme:\s*'dark'/);
  assert.match(source, /fontWeight:\s*900/);
  assert.match(source, /textRendering:\s*'geometricPrecision'/);
  assert.match(source, /mixBlendMode:\s*'normal'/);
  assert.match(source, /panoramaT\('waitingSnapshotPreview'\)/);
  assert.match(source, /text-white/);
  assert.match(source, /panoramaStoryboardPromptSnapshotText/);
  assert.doesNotMatch(source, /previewAlreadyIncludesPrompt/);
  assert.match(utilsSource, /ctx\.shadowColor = 'rgba\(0, 0, 0, \.96\)'/);
  assert.match(utilsSource, /ctx\.font = `900 \$\{panel\.fontSize\}px/);
  assert.match(utilsSource, /ctx\.strokeText\(line \|\| ' ', panel\.paddingX, y, width - panel\.paddingX \* 2\)/);
  assert.match(css, /\.t8-panorama-storyboard-preview-caption/);
  assert.match(css, /-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(css, /data-theme-visual="tech"\]\[data-theme-mode="light"\][\s\S]*\.t8-panorama-storyboard-preview-caption/);
  assert.match(css, /data-panorama-storyboard-preview-caption="true"[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-line="true"/);
  assert.match(css, /\.t8-panorama-storyboard-preview\[data-panorama-storyboard-preview="true"\][\s\S]*color:\s*#ffffff !important/);
  assert.match(css, /data-panorama-storyboard-preview="true"[\s\S]*mix-blend-mode:\s*normal !important/);
  assert.match(css, /data-panorama-storyboard-preview-line="true"[\s\S]*opacity:\s*1 !important/);
  assert.match(css, /data-panorama-storyboard-preview-tone="locked-white"[\s\S]*forced-color-adjust:\s*none !important/);
  assert.match(css, /data-panorama-storyboard-preview-tone="locked-white"[\s\S]*color-scheme:\s*dark !important/);
  assert.match(css, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*font-size:\s*15px !important/);
  assert.match(css, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*font-weight:\s*900 !important/);
  assert.match(css, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*line-height:\s*1\.42 !important/);
  assert.match(css, /Final lock for panorama storyboard live preview/);
  assert.match(css, /\[data-panorama-storyboard-preview-caption="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*background-color:\s*#050505 !important/);
  assert.match(css, /\[data-panorama-storyboard-preview-caption="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*color:\s*#ffffff !important/);
  assert.match(css, /\[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(css, /\[data-panorama-storyboard-preview-placeholder="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*color:\s*rgba\(255,\s*255,\s*255,\s*\.82\) !important/);
  assert.match(css, /True final guard: keep panorama storyboard live-preview text readable in every light theme/);
  assert.match(css, /\[data-panorama-storyboard-preview-safe-color="white"\][\s\S]*-webkit-text-stroke:\s*0\.22px rgba\(255,\s*255,\s*255,\s*\.76\) !important/);
  assert.match(css, /\[data-panorama-storyboard-preview-caption="true"\]\[data-panorama-storyboard-preview-safe-color="white"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(css, /\[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-safe-color="white"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(css, /Day-mode hard guard: the storyboard live preview must stay black-board \/ white-text/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-day-safe="true"[\s\S]*--tw-text-opacity:\s*1 !important/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*font-size:\s*15px !important/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*line-height:\s*1\.42 !important/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-preview-placeholder="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*rgba\(255,\s*255,\s*255,\s*\.84\) !important/);
  assert.match(css, /Color-lock guard: panorama storyboard preview is a black-board \/ white-text artifact/);
  assert.match(css, /data-t8-color-lock="panorama-storyboard-preview"[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(css, /data-t8-color-lock="panorama-storyboard-preview"[\s\S]*opacity:\s*1 !important/);
  assert.match(css, /data-t8-color-lock="panorama-storyboard-preview"\]\[data-panorama-storyboard-preview-line="true"\][\s\S]*font-size:\s*15px !important/);
  assert.match(css, /Runtime contrast lock for panorama storyboard live preview/);
  assert.match(css, /data-panorama-storyboard-preview-contrast-lock="true"[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(css, /data-panorama-storyboard-preview-contrast-lock="true"\]\[data-panorama-storyboard-preview-line="true"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(css, /Readable live preview text guard for the 3D panorama storyboard board/);
  assert.match(css, /data-panorama-storyboard-live-preview-text="white"[\s\S]*paint-order:\s*stroke fill !important/);
  assert.match(css, /data-panorama-storyboard-live-preview-text="white"[\s\S]*0 0 0 #ffffff/);
  assert.match(css, /data-theme-mode="light"[\s\S]*data-panorama-storyboard-live-preview-text="white"[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"[\s\S]*\.t8-panorama-storyboard-preview-caption/);
  assert.match(farmCss, /\.t8-panorama-storyboard-preview-caption-line[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-caption="true"[\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-line="true"[\s\S]*color:\s*#ffffff !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-tone="locked-white"[\s\S]*forced-color-adjust:\s*none !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*font-size:\s*15px !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*font-weight:\s*900 !important/);
  assert.match(farmCss, /data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"[\s\S]*line-height:\s*1\.42 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-panorama-storyboard-preview-caption="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*background-color:\s*#050505 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-panorama-storyboard-preview-placeholder="true"\]\[data-panorama-storyboard-preview-tone="locked-white"\][\s\S]*color:\s*rgba\(255,\s*255,\s*255,\s*\.72\) !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*--tw-text-opacity:\s*1 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*font-size:\s*15px !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-preview-line="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*line-height:\s*1\.42 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-preview-placeholder="true"\]\[data-panorama-storyboard-preview-day-safe="true"\][\s\S]*rgba\(255,\s*255,\s*255,\s*\.84\) !important/);
  assert.match(farmCss, /Farm day-mode final guard: keep 3D panorama storyboard live preview readable/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-t8-color-lock="panorama-storyboard-preview"\][\s\S]*--tw-text-opacity:\s*1 !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-t8-color-lock="panorama-storyboard-preview"\][\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-t8-color-lock="panorama-storyboard-preview"\]\[data-panorama-storyboard-preview-line="true"\][\s\S]*font-weight:\s*900 !important/);
  assert.match(farmCss, /Farm runtime contrast lock for panorama storyboard live preview/);
  assert.match(farmCss, /data-theme-visual="farm-story"\] \[data-panorama-storyboard-preview-contrast-lock="true"\][\s\S]*-webkit-text-fill-color:\s*#ffffff !important/);
  assert.match(farmCss, /Farm readable live preview text guard for the 3D panorama storyboard board/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-live-preview-text="white"\][\s\S]*paint-order:\s*stroke fill !important/);
  assert.match(farmCss, /data-theme-visual="farm-story"\]\[data-theme-mode="light"\] \[data-panorama-storyboard-live-preview-text="white"\][\s\S]*0 0 0 #ffffff/);
});

test('panorama storyboard prompt board manages reusable prompt presets', async () => {
  const source = readFileSync(new URL('../src/components/nodes/Panorama3DNode.tsx', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const features = readFileSync(new URL('../features.json', import.meta.url), 'utf8');
  const utils = await import('../src/utils/panorama3d.ts');

  assert.equal(typeof (utils as any).sanitizePanoramaStoryboardPromptPresets, 'function');
  assert.equal(typeof (utils as any).insertPanoramaStoryboardPresetPrompt, 'function');
  assert.equal(typeof (utils as any).createPanoramaStoryboardPromptPresetExport, 'function');
  assert.equal(typeof (utils as any).parsePanoramaStoryboardPromptPresetImport, 'function');

  const sanitize = (utils as any).sanitizePanoramaStoryboardPromptPresets as (value: unknown) => Array<{ id: string; name: string; text: string }>;
  const insert = (utils as any).insertPanoramaStoryboardPresetPrompt as (scene: unknown, preset: unknown) => string;
  const createExport = (utils as any).createPanoramaStoryboardPromptPresetExport as (presets: unknown) => any;
  const parseImport = (utils as any).parsePanoramaStoryboardPromptPresetImport as (payload: string) => Array<{ id: string; name: string; text: string }>;

  const presets = sanitize([
    { id: 'a', name: '  动作预设  ', text: ' 第一行 ' },
    { id: 'a', name: '重复', text: '第二行' },
    { id: 'empty', name: '', text: '' },
  ]);
  assert.deepEqual(
    presets.map((item) => ({ id: item.id, name: item.name, text: item.text })),
    [
      { id: 'a', name: '动作预设', text: '第一行' },
      { id: 'a-2', name: '重复', text: '第二行' },
    ],
  );
  assert.equal(insert('镜头一', '｛［人物］是@在做［动作］，｝'), '镜头一\n｛［人物］是@在做［动作］，｝');
  assert.equal(insert('', '｛［人物］是@在做［动作］，｝'), '｛［人物］是@在做［动作］，｝');

  const exported = createExport(presets);
  assert.equal(exported.schema, 't8-panorama-storyboard-prompt-presets');
  assert.deepEqual(parseImport(JSON.stringify(exported)), presets);

  assert.match(canvas, /panoramaStoryboardPromptPresets:\s*\[\]/);
  assert.match(canvas, /panoramaStoryboardPresetPrompt:\s*'｛［人物］是@在做［动作］，｝'/);
  assert.match(canvas, /panoramaStoryboardPresetName:\s*''/);
  assert.match(source, /panorama-storyboard-preset-select/);
  assert.match(source, /保存预设/);
  assert.match(source, /插入/);
  assert.match(source, /导出预设/);
  assert.match(source, /导入预设/);
  assert.match(features, /panoramaStoryboardPromptPresets/);
  assert.match(features, /panoramaStoryboardPresetPrompt/);
  assert.match(features, /panoramaStoryboardPresetName/);
});

test('panorama seam score classification gives actionable labels', () => {
  assert.deepEqual(classifyPanoramaSeamScore(96), {
    level: 'excellent',
    seamLabel: '接缝优秀',
    hint: '左右边缘像素差异很小，适合继续预览或入库。',
  });
  assert.equal(classifyPanoramaSeamScore(80).level, 'good');
  assert.equal(classifyPanoramaSeamScore(40).level, 'warning');
  assert.equal(classifyPanoramaSeamScore(null).level, 'unknown');
});

test('resolvePanoramaRatio returns presets and sanitized custom ratios', () => {
  assert.deepEqual(
    PANORAMA_RATIO_OPTIONS.map((item) => item.label),
    ['21:9', '2:1', '自定义'],
  );
  assert.deepEqual(
    Object.values(PANORAMA_RATIO_PRESETS),
    [{ w: 21, h: 9 }, { w: 2, h: 1 }],
  );
  assert.deepEqual(resolvePanoramaRatio('ultrawide', undefined, undefined), { w: 21, h: 9 });
  assert.deepEqual(resolvePanoramaRatio('twoToOne', undefined, undefined), { w: 2, h: 1 });
  assert.deepEqual(resolvePanoramaRatio('wide', 1, 1), { w: 21, h: 9 });
  assert.deepEqual(resolvePanoramaRatio('square', undefined, undefined), { w: 21, h: 9 });
  assert.deepEqual(resolvePanoramaRatio('custom', 21, 9), { w: 21, h: 9 });
  assert.deepEqual(resolvePanoramaRatio('custom', -10, 'bad'), { w: 1, h: 9 });
});

test('panorama 3d node normalizes legacy ratio ids before rendering buttons', () => {
  const source = readFileSync(new URL('../src/components/nodes/Panorama3DNode.tsx', import.meta.url), 'utf8');

  assert.match(source, /normalizePanoramaRatioId\(d\.panoramaRatio\)/);
  assert.doesNotMatch(source, /d\.panoramaRatio\s*\|\|\s*'wide'/);
  assert.match(source, /className="grid grid-cols-3 gap-1\.5"/);
  assert.doesNotMatch(source, /className="grid grid-cols-10 gap-1\.5"/);
});

test('panoramaRenderSize keeps the selected viewport aspect', () => {
  assert.deepEqual(panoramaRenderSize({ w: 16, h: 9 }), { width: 1536, height: 864 });
  assert.deepEqual(panoramaRenderSize({ w: 9, h: 16 }), { width: 864, height: 1536 });
  assert.deepEqual(panoramaRenderSize({ w: 1, h: 1 }, 1024), { width: 1024, height: 1024 });
});

test('isLikelyPanoramaImage detects names and 2:1 dimensions', () => {
  assert.equal(isLikelyPanoramaImage({ label: '展厅 360 全景图.png' }), true);
  assert.equal(isLikelyPanoramaImage({ url: '/output/panorama-room.png' }), true);
  assert.equal(isLikelyPanoramaImage({ width: 4096, height: 2048 }), true);
  assert.equal(isLikelyPanoramaImage({ width: 1024, height: 1024 }), false);
});

test('panorama generation prompt keeps the fixed 720 VR instruction', () => {
  const final = buildPanoramaPromptFinal('赛博朋克雨夜街巷');

  assert.equal(buildPanoramaPromptFinal(''), PANORAMA_FIXED_PROMPT);
  assert.match(final, new RegExp(PANORAMA_FIXED_PROMPT));
  assert.match(final, /赛博朋克雨夜街巷/);
  assert.equal(
    buildPanoramaCameraContextPrompt({ viewerPosition: '站在大厅中央', viewCenter: '正对主展品' }),
    '摄像机位置要求：观看者站位：站在大厅中央。初始视线中心：正对主展品。',
  );
  assert.match(
    buildPanoramaPromptFinal('未来展厅', { viewerPosition: '站在门口向内看', viewCenter: '正对入口' }),
    /摄像机位置要求：观看者站位：站在门口向内看。初始视线中心：正对入口。\n未来展厅/,
  );
});

test('panorama generation validation matches text and image modes', () => {
  assert.deepEqual(validatePanoramaGeneration({ mode: 'text', prompt: '' }), {
    ok: false,
    error: '文生全景需要填写场景提示词',
  });
  assert.deepEqual(validatePanoramaGeneration({ mode: 'image', prompt: '', referenceUrl: '' }), {
    ok: false,
    error: '图生全景需要上游图片或节点内参考图',
  });
  assert.deepEqual(validatePanoramaGeneration({ mode: 'image', referenceUrl: '/files/input/a.png' }), { ok: true });
});

test('panorama image request uses gpt-image-2 21:9 and size levels', () => {
  assert.deepEqual(buildPanoramaImageRequest({
    mode: 'text',
    prompt: '未来展厅',
    sizeLevel: '1K',
    viewerPosition: '站在大厅中央',
    viewCenter: '正对主展品',
  }), {
    model: 'gpt-image-2',
    apiModel: 'gpt-image-2',
    paramKind: 'gpt-size',
    prompt: `${PANORAMA_FIXED_PROMPT}\n摄像机位置要求：观看者站位：站在大厅中央。初始视线中心：正对主展品。\n未来展厅`,
    aspectRatio: '21:9',
    aspect_ratio: '21:9',
    sizeLevel: '1K',
    image_size: '1K',
    images: [],
    n: 1,
  });
  assert.deepEqual(buildPanoramaImageRequest({
    mode: 'image',
    prompt: '',
    sizeLevel: '2K',
    referenceUrl: '/files/input/ref.png',
  }), {
    model: 'gpt-image-2',
    apiModel: 'gpt-image-2',
    paramKind: 'gpt-size',
    prompt: PANORAMA_FIXED_PROMPT,
    aspectRatio: '21:9',
    aspect_ratio: '21:9',
    sizeLevel: '2K',
    image_size: '2K',
    images: ['/files/input/ref.png'],
    n: 1,
  });
});

test('panorama camera views can be saved, defaulted and deleted safely', () => {
  let views = upsertPanoramaCameraView([], {
    name: '入口',
    yaw: 372,
    pitch: 12,
    fov: 70,
    isDefault: true,
  });
  views = upsertPanoramaCameraView(views, { name: '主展品', yaw: -90, pitch: 0, fov: 55 });

  assert.equal(views.length, 2);
  assert.equal(views[1].yaw, 12);
  assert.equal(views[1].isDefault, true);

  views = markPanoramaDefaultCameraView(views, views[0].id);
  assert.equal(views.filter((item) => item.isDefault).length, 1);
  assert.equal(views[0].isDefault, true);

  const oversized = Array.from({ length: PANORAMA_CAMERA_VIEW_LIMIT + 4 }, (_, i) => ({
    id: `v${i}`,
    name: `机位 ${i}`,
    yaw: i,
    pitch: 0,
    fov: 75,
    createdAt: '2026-06-05T00:00:00.000Z',
  }));
  assert.equal(sanitizePanoramaCameraViews(oversized).length, PANORAMA_CAMERA_VIEW_LIMIT);
  assert.equal(deletePanoramaCameraView(views, views[0].id).length, 1);
});

test('panorama hotspots support click placement, projection and updates', () => {
  const placed = screenPointToPanoramaAngles({
    xRatio: 0.75,
    yRatio: 0.25,
    view: { yaw: 0, pitch: 0, fov: 80 },
    aspect: 16 / 9,
  });
  assert.equal(placed.pitch, 20);
  assert.ok(placed.yaw > 30 && placed.yaw < 40);

  let hotspots = upsertPanoramaHotspot([], {
    label: '去主厅',
    yaw: placed.yaw,
    pitch: placed.pitch,
    fov: 70,
    targetNodeId: 'target-panorama',
    targetYaw: 15,
    targetPitch: 5,
    targetFov: 65,
  });
  assert.equal(hotspots.length, 1);
  assert.equal(hotspots[0].label, '去主厅');
  assert.equal(hotspots[0].targetNodeId, 'target-panorama');

  const projected = projectPanoramaHotspot({
    hotspot: hotspots[0],
    view: { yaw: placed.yaw, pitch: placed.pitch, fov: 80 },
    aspect: 16 / 9,
  });
  assert.equal(projected.visible, true);
  assert.equal(Math.round(projected.x), 50);
  assert.equal(Math.round(projected.y), 50);

  hotspots = updatePanoramaHotspot(hotspots, hotspots[0].id, { label: '去出口' });
  assert.equal(hotspots[0].label, '去出口');
  assert.equal(deletePanoramaHotspot(hotspots, hotspots[0].id).length, 0);
});

test('panorama avatars sanitize, update and project as scene actors', () => {
  let avatars = upsertPanoramaAvatar([], {
    name: '女主',
    yaw: 372,
    pitch: -22,
    distance: 260,
    scale: 1.25,
    heading: -190,
    faceMode: 'heading',
    poseId: 'wave',
    groundMode: 'floating',
    rootHeight: 260,
    rootPitch: -120,
    rootRoll: 180,
    color: '#ff0000',
    opacity: 0.8,
  });
  avatars = upsertPanoramaAvatar(avatars, {
    name: '男主',
    yaw: -35,
    pitch: -18,
    poseId: 'pointing',
    color: '#0000ff',
  });

  assert.equal(avatars.length, 2);
  assert.equal(avatars[1].yaw, 12);
  assert.equal(avatars[1].heading, 170);
  assert.equal(avatars[1].poseId, 'wave');
  assert.equal(avatars[1].groundMode, 'floating');
  assert.equal(avatars[1].rootHeight, 180);
  assert.equal(avatars[1].rootPitch, -90);
  assert.equal(avatars[1].rootRoll, 120);
  assert.equal(avatars[0].poseId, 'pointing');

  const projected = projectPanoramaAvatar({
    avatar: avatars[1],
    view: { yaw: 12, pitch: -22, fov: 75 },
    aspect: 16 / 9,
  });
  assert.equal(projected.visible, true);
  assert.equal(Math.round(projected.x), 50);
  assert.equal(Math.round(projected.y), 50);

  avatars = updatePanoramaAvatar(avatars, avatars[0].id, { visible: false, distance: 999, opacity: -1 });
  assert.equal(avatars[0].visible, false);
  assert.equal(avatars[0].distance, 420);
  assert.equal(avatars[0].opacity, 0.15);

  const oversized = Array.from({ length: PANORAMA_AVATAR_LIMIT + 3 }, (_, i) => ({
    id: `a${i}`,
    name: `角色 ${i}`,
    yaw: i * 30,
    poseId: i % 2 ? 'flying-kick' : 'unknown',
  }));
  assert.equal(sanitizePanoramaAvatars(oversized).length, PANORAMA_AVATAR_LIMIT);
  assert.equal(sanitizePanoramaAvatars(oversized)[0].poseId, 'standing');
  assert.equal(sanitizePanoramaAvatars(oversized)[1].poseId, 'flying-kick');
});

test('panorama director keyframes and occlusion masks are structured references', () => {
  const avatars = sanitizePanoramaAvatars([
    {
      id: 'hero',
      name: '红色角色',
      color: '#ef4444',
      yaw: -10,
      pitch: -18,
      poseId: 'standing',
      visible: true,
    },
  ]);
  let keyframes = upsertPanoramaAvatarKeyframe([], {
    ...avatars[0],
    avatarId: avatars[0].id,
    avatarName: avatars[0].name,
    label: '起势',
    time: -5,
    poseId: 'standing',
  }, avatars);
  keyframes = upsertPanoramaAvatarKeyframe(keyframes, {
    ...avatars[0],
    avatarId: avatars[0].id,
    avatarName: avatars[0].name,
    label: '飞踢命中',
    time: 1.6,
    poseId: 'flying-kick',
    rootHeight: 72,
    rootPitch: -18,
    note: '右脚踢向镜头',
  }, avatars);
  assert.equal(keyframes.length, 2);
  assert.equal(keyframes[0].time, 0);
  assert.equal(keyframes[1].poseId, 'flying-kick');

  const oversizedKeyframes = Array.from({ length: PANORAMA_AVATAR_KEYFRAME_LIMIT + 3 }, (_, i) => ({
    id: `kf${i}`,
    avatarId: 'hero',
    label: `K${i}`,
    time: i,
  }));
  assert.equal(sanitizePanoramaAvatarKeyframes(oversizedKeyframes, avatars).length, PANORAMA_AVATAR_KEYFRAME_LIMIT);

  let masks = upsertPanoramaOcclusionMask([], {
    label: '桌沿',
    x: -20,
    y: 62,
    w: 150,
    h: 12,
    strength: 140,
    note: '前景遮挡腿部',
  });
  assert.equal(masks[0].x, 0);
  assert.equal(masks[0].w, 100);
  assert.equal(masks[0].strength, 100);
  const oversizedMasks = Array.from({ length: PANORAMA_OCCLUSION_MASK_LIMIT + 2 }, (_, i) => ({ id: `m${i}`, label: `遮挡${i}` }));
  assert.equal(sanitizePanoramaOcclusionMasks(oversizedMasks).length, PANORAMA_OCCLUSION_MASK_LIMIT);

  const keyframePrompt = buildPanoramaKeyframePrompt({ keyframes, avatars });
  assert.match(keyframePrompt, /动作时间轴参考/);
  assert.match(keyframePrompt, /飞踢命中 1\.6s/);
  assert.match(keyframePrompt, /右脚踢向镜头/);
  assert.match(keyframePrompt, new RegExp(`${PANORAMA_KEYFRAME_SEQUENCE_DEFAULT} 帧动作序列`));
  assert.equal(sanitizePanoramaSequenceFrameCount(999), 48);

  const sequenceFrames = buildPanoramaAvatarSequenceFrames({
    keyframes,
    avatars,
    view: { yaw: 0, pitch: -12, fov: 75 },
    width: 1536,
    height: 864,
    frameCount: 5,
    imageUrls: ['/files/output/f01.png', '/files/output/f02.png'],
  });
  assert.equal(sequenceFrames.length, 5);
  assert.equal(sequenceFrames[0].frameLabel, 'F01');
  assert.equal(sequenceFrames[0].imageUrl, '/files/output/f01.png');
  assert.equal(sequenceFrames[4].frameLabel, 'F05');
  assert.equal(sequenceFrames[2].avatars[0].avatarId, 'hero');
  assert.ok(sequenceFrames[2].avatars[0].rootHeight > 0);

  const combatRoot = panoramaAvatarPoseRootDefaults('combat');
  const punchRoot = panoramaAvatarPoseRootDefaults('karate-punch');
  const punchSequence = buildPanoramaAvatarSequenceFrames({
    avatars: sanitizePanoramaAvatars([{ id: 'puncher', name: '出拳角色', poseId: 'karate-punch', visible: true }]),
    keyframes: sanitizePanoramaAvatarKeyframes([
      {
        avatarId: 'puncher',
        label: '起势',
        time: 0,
        poseId: 'combat',
        ...combatRoot,
        poseParams: panoramaAvatarPoseDefaultParams('combat'),
      },
      {
        avatarId: 'puncher',
        label: '直拳',
        time: 1,
        poseId: 'karate-punch',
        ...punchRoot,
        poseParams: panoramaAvatarPoseDefaultParams('karate-punch'),
      },
    ], [{ id: 'puncher', name: '出拳角色', poseId: 'standing' }]),
    view: { yaw: 0, pitch: -12, fov: 75 },
    width: 1536,
    height: 864,
    frameCount: 6,
  });
  const startArmR = punchSequence[0].avatars[0].poseParams?.armRZ as number;
  const midArmR = punchSequence[3].avatars[0].poseParams?.armRZ as number;
  const endArmR = punchSequence[5].avatars[0].poseParams?.armRZ as number;
  assert.ok(midArmR > startArmR + 0.35);
  assert.ok(endArmR > midArmR);
  assert.ok(punchSequence[3].avatars[0].rootPitch < -3);

  const occlusionPrompt = buildPanoramaOcclusionPrompt({ occlusionMasks: masks });
  assert.match(occlusionPrompt, /遮挡参考/);
  assert.match(occlusionPrompt, /桌沿/);
  assert.match(occlusionPrompt, /不代表全景图有真实深度/);

  const snapshot = buildPanoramaSceneSnapshot({
    sourceUrl: '/files/output/panorama.png',
    view: { yaw: 0, pitch: -12, fov: 75 },
    width: 1536,
    height: 864,
    avatars,
    keyframes,
    sequenceFrameCount: 5,
    sequenceFrameUrls: ['/files/output/f01.png', '/files/output/f02.png', '/files/output/f03.png', '/files/output/f04.png', '/files/output/f05.png'],
    occlusionMasks: masks,
    snapshotUrl: '/files/output/scene.png',
    controlSnapshotUrl: '/files/output/control.png',
  });
  assert.equal(snapshot.keyframes.length, 2);
  assert.equal(snapshot.sequenceFrameCount, 5);
  assert.equal(snapshot.sequenceFrames.length, 5);
  assert.equal(snapshot.sequenceFrames[4].imageUrl, '/files/output/f05.png');
  assert.equal(snapshot.occlusionMasks.length, 1);
  assert.equal(snapshot.controlSnapshotUrl, '/files/output/control.png');
  assert.match(snapshot.promptText, /动作时间轴参考/);
  assert.match(snapshot.promptText, /遮挡参考/);
});

test('panorama director shot camera targets body parts for close-up references', () => {
  const avatars = sanitizePanoramaAvatars([
    {
      id: 'hero',
      name: '红色角色',
      yaw: 0,
      pitch: -18,
      scale: 1.2,
      poseId: 'standing',
      visible: true,
    },
  ]);
  const shotCamera = sanitizePanoramaShotCamera({
    mode: 'shot-camera',
    presetId: 'foot-closeup',
    targetAvatarId: 'hero',
    targetBone: 'rightFoot',
    framingRatio: '9:16',
    closeupStrength: 140,
    lowAngle: -20,
  });
  assert.equal(shotCamera.mode, 'shot-camera');
  assert.equal(shotCamera.presetId, 'foot-closeup');
  assert.equal(shotCamera.targetBone, 'rightFoot');
  assert.equal(shotCamera.closeupStrength, 100);
  assert.equal(shotCamera.lowAngle, 0);

  const target = projectPanoramaShotTarget({
    shotCamera,
    avatars,
    view: { yaw: 0, pitch: -18, fov: 75 },
    aspect: 16 / 9,
  });
  assert.equal(target.visible, true);
  assert.equal(Math.round(target.x), 55);
  assert.ok(target.y > 60);
  assert.match(target.label, /红色角色 · 右脚/);

  const prompt = buildPanoramaShotCameraPrompt({ shotCamera, avatars });
  assert.match(prompt, /导演镜头参考：脚部特写/);
  assert.match(prompt, /镜头目标锁定「红色角色」的右脚/);
  assert.match(prompt, /low angle close-up on the foot/);
  assert.match(prompt, /不代表单张全景内存在真实平移视差/);

  assert.deepEqual(sanitizePanoramaShotCamera(null), PANORAMA_SHOT_CAMERA_DEFAULT);
});

test('panorama action planner turns prompt text into actors, keyframes and shot camera', () => {
  assert.equal(PANORAMA_ACTION_PLAN_SCHEMA, 't8-panorama-action-plan');
  assert.ok(PANORAMA_AVATAR_POSES.length >= 100);
  assert.equal(new Set(PANORAMA_AVATAR_POSES.map((pose) => pose.id)).size, PANORAMA_AVATAR_POSES.length);
  assert.ok(PANORAMA_AVATAR_POSES.every((pose) => pose.prompt && pose.keywords?.length));
  assert.ok(PANORAMA_AVATAR_POSES.some((pose) => pose.id === 'taekwondo-roundhouse'));
  assert.ok(PANORAMA_ACTION_TERMS.some((term) => term.id === 'flying-kick'));
  assert.ok(PANORAMA_ACTION_TERMS.some((term) => term.id === 'foot-closeup'));
  assert.ok(PANORAMA_ACTION_TERMS.some((term) => term.id === 'taekwondo-roundhouse'));
  assert.equal(inferPanoramaAvatarPoseFromText('跆拳道'), 'taekwondo-roundhouse');
  assert.equal(panoramaAvatarPoseRootDefaults('taekwondo-roundhouse').groundMode, 'floating');
  assert.ok((panoramaAvatarPoseDefaultParams('taekwondo-roundhouse')?.legRZ as number) > 1);

  const plan = buildPanoramaLocalActionPlan({
    prompt: '角色B飞踢角色A，角色A受击后仰，低机位脚部特写，生成8帧动作序列',
    view: { yaw: 5, pitch: -12, fov: 75 },
    mode: 'append',
  });
  assert.equal(plan.schema, PANORAMA_ACTION_PLAN_SCHEMA);
  assert.equal(plan.avatars.length, 2);
  const victim = plan.avatars.find((avatar) => avatar.ref === '角色A');
  const attacker = plan.avatars.find((avatar) => avatar.ref === '角色B');
  assert.equal(victim?.poseId, 'hit-back');
  assert.equal(attacker?.poseId, 'flying-kick');
  assert.equal(attacker?.groundMode, 'floating');
  assert.ok((attacker?.rootHeight || 0) > 0);
  assert.equal(plan.sequenceFrameCount, 6);
  assert.ok((plan.keyframes || []).length >= 4);
  assert.equal(plan.shotCamera?.mode, 'shot-camera');
  assert.equal(plan.shotCamera?.presetId, 'foot-closeup');
  assert.equal(plan.shotCamera?.targetBone, 'rightFoot');
  assert.equal(plan.shotCamera?.targetAvatarRef, '角色B');

  const sanitized = sanitizePanoramaActionPlan({
    schema: PANORAMA_ACTION_PLAN_SCHEMA,
    version: 1,
    mode: 'replace-actors',
    prompt: '脚部特写',
    avatars: [{ ref: '角色A', poseId: 'unknown', yaw: 999, scale: 10 }],
    keyframes: [{ avatarRef: '角色A', time: 99, poseId: 'flying-kick' }],
    shotCamera: { mode: 'shot-camera', presetId: 'foot-closeup', targetAvatarRef: '角色A' },
  });
  assert.equal(sanitized.mode, 'replace-actors');
  assert.equal(sanitized.avatars[0].poseId, 'standing');
  assert.equal(sanitized.avatars[0].yaw, -81);
  assert.equal(sanitized.avatars[0].scale, 2.6);
  assert.equal(sanitized.keyframes?.[0].time, 30);

  const taekwondoPlan = buildPanoramaLocalActionPlan({
    prompt: '跆拳道',
    view: { yaw: 0, pitch: -10, fov: 75 },
    mode: 'append',
  });
  assert.equal(taekwondoPlan.avatars[0].poseId, 'taekwondo-roundhouse');
  assert.equal(taekwondoPlan.avatars[0].groundMode, 'floating');
  assert.ok((taekwondoPlan.avatars[0].poseParams?.legRZ as number) > 1);
  assert.equal(taekwondoPlan.keyframes?.[0].poseId, 'combat');
  assert.equal(taekwondoPlan.keyframes?.[1].poseId, 'taekwondo-roundhouse');

  const staticAiPlan = sanitizePanoramaActionPlan({
    schema: PANORAMA_ACTION_PLAN_SCHEMA,
    version: 1,
    mode: 'append',
    prompt: '跆拳道三段动作',
    sequenceFrameCount: 48,
    avatars: [{ ref: '角色A', poseId: 'taekwondo-roundhouse' }],
    keyframes: [
      { avatarRef: '角色A', time: 0, poseId: 'taekwondo-roundhouse' },
      { avatarRef: '角色A', time: 20, poseId: 'taekwondo-roundhouse' },
      { avatarRef: '角色A', time: 20, poseId: 'taekwondo-roundhouse' },
    ],
  });
  assert.equal(staticAiPlan.sequenceFrameCount, 12);
  assert.deepEqual(staticAiPlan.keyframes?.map((frame) => frame.time), [0, 1, 2]);
  assert.equal(staticAiPlan.keyframes?.[0].poseId, 'combat');
  assert.equal(staticAiPlan.keyframes?.[2].poseId, 'taekwondo-roundhouse');

  const parsed = parsePanoramaActionPlanJson(`\`\`\`json
{"schema":"t8-panorama-action-plan","version":1,"mode":"append","prompt":"挥手","avatars":[{"ref":"当前角色","poseId":"wave"}]}
\`\`\``);
  assert.equal(parsed?.avatars[0].poseId, 'wave');

  const systemPrompt = buildPanoramaActionPlannerSystemPrompt();
  const userPrompt = buildPanoramaActionPlannerUserPrompt({
    prompt: '角色A挥手',
    view: { yaw: 0, pitch: -10, fov: 75 },
    avatars: [{ id: 'a1', name: '角色1', poseId: 'standing' }],
    activeAvatarId: 'a1',
  });
  assert.match(systemPrompt, /只输出 JSON/);
  assert.match(systemPrompt, /t8-panorama-action-plan/);
  assert.match(systemPrompt, /每个动作段最多 6 帧/);
  assert.match(systemPrompt, /taekwondo-roundhouse/);
  assert.match(userPrompt, /用户动作导演指令：角色A挥手/);
  assert.match(userPrompt, /active=true/);
});

test('panorama scene snapshot keeps source panorama and generates video prompt', () => {
  const avatars = [
    {
      id: 'hero',
      name: '红色女主',
      color: '#ef4444',
      yaw: -24,
      pitch: -18,
      distance: 180,
      scale: 1.1,
      heading: 0,
      faceMode: 'camera',
      poseId: 'flying-kick',
      groundMode: 'floating',
      rootHeight: 64,
      rootPitch: -18,
      rootRoll: 28,
      characterPrompt: '红色外套，短发',
      visible: true,
    },
    {
      id: 'bg',
      name: '蓝色路人',
      color: '#3b82f6',
      yaw: 72,
      pitch: -15,
      distance: 360,
      poseId: 'walking',
      visible: true,
    },
  ];
  const prompt = buildPanoramaScenePrompt({
    avatars,
    view: { yaw: 0, pitch: -12, fov: 75 },
    shotCamera: {
      mode: 'shot-camera',
      presetId: 'foot-closeup',
      targetAvatarId: 'hero',
      targetBone: 'rightFoot',
      framingRatio: '16:9',
      closeupStrength: 86,
      lowAngle: 84,
    },
  });
  assert.match(prompt, /全景人物布局参考/);
  assert.match(prompt, /#ef4444 角色「红色女主」/);
  assert.match(prompt, /动作：悬空飞踢/);
  assert.match(prompt, /Root状态：整体离地约64单位/);
  assert.match(prompt, /身体前倾18度/);
  assert.match(prompt, /角色设定：红色外套，短发/);
  assert.match(prompt, /导演镜头参考：脚部特写/);

  const snapshot = buildPanoramaSceneSnapshot({
    sourceUrl: '/files/output/panorama.png',
    promptFinal: '全景提示词',
    view: { yaw: 0, pitch: -12, fov: 75 },
    ratioId: 'ultrawide',
    width: 1536,
    height: 658,
    avatars,
    compositionGuide: '16:9',
    shotCamera: {
      mode: 'shot-camera',
      presetId: 'foot-closeup',
      targetAvatarId: 'hero',
      targetBone: 'rightFoot',
      framingRatio: '16:9',
      closeupStrength: 86,
      lowAngle: 84,
    },
    snapshotUrl: '/files/output/panorama-scene.png',
  });
  assert.equal(snapshot.schema, 't8-panorama-scene-snapshot');
  assert.equal(snapshot.background.sourceUrl, '/files/output/panorama.png');
  assert.equal(snapshot.background.yaw, 0);
  assert.equal(snapshot.compositionGuide, '16:9');
  assert.equal(snapshot.snapshotUrl, '/files/output/panorama-scene.png');
  assert.equal(snapshot.avatars.length, 2);
  assert.equal(snapshot.avatars[0].poseLabel, '飞踢');
  assert.equal(snapshot.avatars[0].groundMode, 'floating');
  assert.equal(snapshot.avatars[0].rootHeight, 64);
  assert.equal(snapshot.avatars[0].rootPitch, -18);
  assert.equal(snapshot.avatars[0].rootRoll, 28);
  assert.equal(snapshot.shotCamera.mode, 'shot-camera');
  assert.equal(snapshot.shotCamera.targetBone, 'rightFoot');
  assert.equal(snapshot.shotTarget?.visible, true);
  assert.match(snapshot.promptText, /离地高度、身体倾斜和动作关系/);
  assert.match(snapshot.promptText, /feet dominating foreground/);
});

test('panorama generation history is newest-first and capped', () => {
  const base = [
    { url: '/old-1.png', mode: 'text', sizeLevel: '1K', prompt: 'a', promptFinal: 'a', createdAt: '1' },
    { url: '/old-2.png', mode: 'image', sizeLevel: '2K', prompt: 'b', promptFinal: 'b', createdAt: '2' },
    { url: '/old-3.png', mode: 'text', sizeLevel: '1K', prompt: 'c', promptFinal: 'c', createdAt: '3' },
  ];
  const next = prependPanoramaHistory(base, {
    url: '/new.png',
    mode: 'text',
    sizeLevel: '1K',
    prompt: 'n',
    promptFinal: 'n',
    createdAt: '4',
  });

  assert.deepEqual(next.map((item) => item.url), ['/new.png', '/old-1.png', '/old-2.png']);
});
