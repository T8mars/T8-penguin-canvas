import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildAnnotationEditRequest,
  buildAnnotationEditResultPlacement,
  buildCreativeTargetResult,
  collectCanvasSelectionSummary,
  createCanvasResourcePackageManifest,
  prepareCanvasResourcePackageImport,
} from '../src/utils/canvasCreativeWorkflow.ts';
import { getMediaItemsFromData } from '../src/utils/mediaCollection.ts';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('creative selection summary captures ids, materials, text, bounds, and default right-side placement', () => {
  const nodes = [
    {
      id: 'text-1',
      type: 'text',
      selected: true,
      position: { x: 10, y: 20 },
      measured: { width: 280, height: 120 },
      data: { text: '春日牧场、木屋、柔和阳光' },
    },
    {
      id: 'out-1',
      type: 'output',
      selected: true,
      position: { x: 360, y: 40 },
      measured: { width: 320, height: 260 },
      data: {
        imageUrl: '/files/output/farm.png',
        videoUrls: ['/files/output/farm.mp4'],
        directOutputText: '一张完成图',
      },
    },
    {
      id: 'idle-1',
      type: 'image',
      selected: false,
      position: { x: 900, y: 100 },
      data: { prompt: '未选中内容不能进入摘要' },
    },
  ];

  const summary = collectCanvasSelectionSummary(nodes as any, {
    canvasId: 'canvas-a',
    viewportAnchor: { x: 1000, y: 500 },
  });

  assert.deepEqual(summary.selectedNodeIds, ['text-1', 'out-1']);
  assert.deepEqual(summary.nodeTypes, ['text', 'output']);
  assert.equal(summary.texts.map((item) => item.text).join('\n'), '春日牧场、木屋、柔和阳光\n一张完成图');
  assert.deepEqual(summary.images.map((item) => item.url), ['/files/output/farm.png']);
  assert.deepEqual(summary.videos.map((item) => item.url), ['/files/output/farm.mp4']);
  assert.deepEqual(summary.bounds, { x: 10, y: 20, w: 670, h: 280 });
  assert.equal(summary.defaultResultPosition.x, 760);
  assert.equal(summary.defaultResultPosition.y, 20);
  assert.equal(summary.canvasId, 'canvas-a');
});

test('creative target results support replace-in-slot and keep-version output beside target', () => {
  const targetNode = {
    id: 'target-1',
    type: CREATIVE_TARGET_NODE_TYPE,
    position: { x: 400, y: 300 },
    measured: { width: 360, height: 220 },
    data: {
      title: '首页主视觉',
      prompt: '生成一张温暖的牧场主视觉',
      resultUrl: '/files/output/old.png',
      resultVersions: [{ url: '/files/output/old.png', createdAt: 1 }],
    },
  };

  const replace = buildCreativeTargetResult(targetNode as any, ['/files/output/new.png'], {
    mode: 'replace',
    sourceNodeIds: ['text-1'],
    now: 100,
  });
  assert.equal(replace.targetPatch.status, 'success');
  assert.equal(replace.targetPatch.resultUrl, '/files/output/new.png');
  assert.equal(replace.targetPatch.imageUrl, '/files/output/new.png');
  assert.deepEqual(replace.targetPatch.imageUrls, ['/files/output/new.png']);
  assert.equal(replace.targetPatch.directImageUrl, '/files/output/new.png');
  assert.deepEqual(getMediaItemsFromData(replace.targetPatch, 'image').map((item) => item.url), [
    '/files/output/new.png',
  ]);
  assert.deepEqual(getMediaItemsFromData({
    resultUrl: '/files/output/legacy.png',
    resultUrls: ['/files/output/legacy.png', '/files/output/legacy-2.png'],
  }, 'image').map((item) => item.url), [
    '/files/output/legacy.png',
    '/files/output/legacy-2.png',
  ]);
  assert.deepEqual(replace.targetPatch.resultVersions.map((item: any) => item.url), [
    '/files/output/new.png',
    '/files/output/old.png',
  ]);
  assert.equal(replace.outputNode, null);

  const version = buildCreativeTargetResult(targetNode as any, ['/files/output/version.png'], {
    mode: 'keep-version',
    sourceNodeIds: ['text-1'],
    now: 120,
  });
  assert.equal(version.targetPatch.status, 'success');
  assert.equal(version.targetPatch.resultUrl, '/files/output/old.png');
  assert.equal(version.targetPatch.imageUrl, '/files/output/old.png');
  assert.deepEqual(getMediaItemsFromData(version.targetPatch, 'image').map((item) => item.url), [
    '/files/output/old.png',
  ]);
  assert.equal(version.outputNode?.type, 'output');
  assert.deepEqual(version.outputNode?.position, { x: 840, y: 300 });
  assert.equal((version.outputNode?.data as any).imageUrl, '/files/output/version.png');
  assert.equal((version.outputNode?.data as any).creativeTargetId, 'target-1');
  assert.deepEqual((version.outputNode?.data as any).creativeSourceNodeIds, ['text-1']);
});

test('annotation edit request keeps clean source and annotated image separate and requires intent for shape-only marks', () => {
  const req = buildAnnotationEditRequest({
    sourceNodeId: 'out-1',
    sourceImageUrl: '/files/output/original.png',
    annotatedImageUrl: '/files/output/annotated.png',
    instruction: '把圈出的招牌改成木质公告牌，其他构图保持不变',
    annotationTextCount: 0,
    annotationShapeCount: 3,
  });

  assert.deepEqual(req.images, ['/files/output/original.png', '/files/output/annotated.png']);
  assert.match(req.prompt, /保留原图主体、构图和风格/);
  assert.match(req.prompt, /移除所有箭头、框线、标号和编辑痕迹/);
  assert.equal(req.metadata.sourceNodeId, 'out-1');
  assert.equal(req.metadata.annotationShapeCount, 3);

  assert.throws(
    () => buildAnnotationEditRequest({
      sourceImageUrl: '/files/output/original.png',
      annotatedImageUrl: '/files/output/annotated.png',
      instruction: '   ',
      annotationTextCount: 0,
      annotationShapeCount: 2,
    }),
    /请补充改图说明/,
  );
});

test('annotation edit results land beside the source or fill the selected target with metadata intact', () => {
  const request = buildAnnotationEditRequest({
    sourceNodeId: 'out-1',
    sourceImageUrl: '/files/output/original.png',
    annotatedImageUrl: '/files/output/annotated.png',
    instruction: '把圈出的招牌改成木质公告牌，其他构图保持不变',
    annotationTextCount: 1,
    annotationShapeCount: 3,
    providerId: 'openai-compatible',
    providerModel: 'gpt-image-2',
  });
  const sourceNode = {
    id: 'out-1',
    type: 'output',
    position: { x: 100, y: 120 },
    measured: { width: 320, height: 260 },
    data: { imageUrl: '/files/output/original.png' },
  };

  const beside = buildAnnotationEditResultPlacement({
    sourceNode: sourceNode as any,
    resultUrls: ['/files/output/edited.png'],
    request,
    now: '2026-06-23T08:00:00.000Z',
  });
  assert.equal(beside.targetPatch, null);
  assert.equal(beside.outputNode?.type, 'output');
  assert.deepEqual(beside.outputNode?.position, { x: 500, y: 120 });
  assert.equal((beside.outputNode?.data as any).imageUrl, '/files/output/edited.png');
  assert.equal((beside.outputNode?.data as any).creativeWorkflowKind, 'annotation-edit');
  assert.equal((beside.outputNode?.data as any).annotationEdit.sourceNodeId, 'out-1');
  assert.equal((beside.outputNode?.data as any).annotationEdit.sourceImageUrl, '/files/output/original.png');
  assert.equal((beside.outputNode?.data as any).annotationEdit.annotatedImageUrl, '/files/output/annotated.png');
  assert.equal((beside.outputNode?.data as any).annotationEdit.providerModel, 'gpt-image-2');
  assert.match((beside.outputNode?.data as any).prompt, /木质公告牌/);

  const targetNode = {
    id: 'target-1',
    type: CREATIVE_TARGET_NODE_TYPE,
    position: { x: 900, y: 120 },
    measured: { width: 360, height: 240 },
    data: { title: '改图结果位', prompt: '牧场公告牌' },
  };
  const toTarget = buildAnnotationEditResultPlacement({
    sourceNode: sourceNode as any,
    targetNode: targetNode as any,
    targetMode: 'replace',
    resultUrls: ['/files/output/edited-target.png'],
    request,
    now: '2026-06-23T08:01:00.000Z',
  });
  assert.equal(toTarget.outputNode, null);
  assert.equal(toTarget.targetPatch?.resultUrl, '/files/output/edited-target.png');
  assert.equal(toTarget.targetPatch?.creativeWorkflowKind, 'annotation-edit');
  assert.equal(toTarget.targetPatch?.annotationEdit.targetSlotId, 'target-1');
  assert.deepEqual(toTarget.targetPatch?.creativeSourceNodeIds, ['out-1']);
});

test('resource package manifest is lightweight, reports missing files, and strips secrets/base64 payloads', () => {
  const manifest = createCanvasResourcePackageManifest({
    canvasId: 'canvas-a',
    title: '交付画布',
    canvas: {
      nodes: [
        {
          id: 'out-1',
          type: 'output',
          position: { x: 0, y: 0 },
          data: {
            imageUrl: '/files/output/farm.png',
            imageUrls: ['/files/output/farm.png', '/files/output/missing.png'],
            directOutputText: '短文本保留',
            referenceImages: ['data:image/png;base64,AAAA'],
            apiKey: 'sk-secret',
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    existingFiles: new Set(['/files/output/farm.png']),
    portable: false,
    now: '2026-06-23T00:00:00.000Z',
  });

  assert.equal(manifest.schema, 't8-canvas-resource-package');
  assert.equal(manifest.resources.length, 2);
  assert.equal(manifest.resources.filter((item) => item.available).length, 1);
  assert.deepEqual(manifest.missingFiles.map((item) => item.url), ['/files/output/missing.png']);
  assert.equal(manifest.filesToCopy.length, 0);
  assert.equal((manifest.canvas.nodes[0].data as any).apiKey, undefined);
  assert.deepEqual((manifest.canvas.nodes[0].data as any).referenceImages, []);
  assert.equal(JSON.stringify(manifest).includes('data:image/png;base64'), false);
  assert.equal(JSON.stringify(manifest).includes('sk-secret'), false);
});

test('resource package carries importable library references, thumbnails, and a bounded history summary', () => {
  const manifest = createCanvasResourcePackageManifest({
    canvasId: 'canvas-a',
    title: '交付画布',
    canvas: {
      nodes: [
        {
          id: 'out-1',
          type: 'output',
          position: { x: 0, y: 0 },
          data: {
            imageUrl: '/files/output/farm.png',
            apiKey: 'sk-secret',
          },
        },
      ],
      edges: [],
    },
    existingFiles: new Set(['/files/output/farm.png']),
    portable: true,
    resourceLibrary: {
      categories: [{ id: 'image-farm', kind: 'image', name: '牧场素材', apiToken: 'private-token' }],
      items: [{
        id: 'res-farm',
        kind: 'image',
        title: '木屋',
        categoryId: 'image-farm',
        fileUrl: '/api/resources/file/res-farm',
        thumbUrl: '/api/resources/thumb/res-farm',
      }],
    },
    thumbnails: [{ id: 'thumb-farm', url: '/files/thumbnails/farm.webp', sourceUrl: '/files/output/farm.png' }],
    generationHistory: [
      { id: 'h1', kind: 'image', nodeId: 'out-1', title: '木屋图', createdAt: 100, url: '/files/output/farm.png' },
      { id: 'h2', kind: 'text', nodeId: 'text-1', title: '提示词', createdAt: 90, textPreview: '牧场木屋' },
    ],
    now: '2026-06-23T08:02:00.000Z',
  });

  assert.equal(manifest.portable, true);
  assert.equal(manifest.filesToCopy.length, 1);
  assert.equal(manifest.resourceLibrary.categories[0].name, '牧场素材');
  assert.equal((manifest.resourceLibrary.categories[0] as any).apiToken, undefined);
  assert.equal(manifest.resourceLibrary.items[0].categoryId, 'image-farm');
  assert.equal(manifest.thumbnailRefs[0].url, '/files/thumbnails/farm.webp');
  assert.equal(manifest.generationHistorySummary.total, 2);
  assert.equal(manifest.generationHistorySummary.byKind.image, 1);
  assert.equal(manifest.generationHistorySummary.byKind.text, 1);

  const plan = prepareCanvasResourcePackageImport(manifest);
  assert.equal(plan.canvas.nodes[0].id, 'out-1');
  assert.equal(plan.resourceLibrary.categories.length, 1);
  assert.equal(plan.resourceLibrary.items.length, 1);
  assert.equal(plan.thumbnailRefs.length, 1);
  assert.equal(plan.generationHistorySummary.total, 2);
  assert.equal(JSON.stringify(plan).includes('sk-secret'), false);
  assert.equal(JSON.stringify(plan).includes('private-token'), false);
});

test('image edit board actions await async production and route Provider edits through persisted node runs', () => {
  const modal = read('../src/components/nodes/ImageEditModal.tsx');
  const outputNode = read('../src/components/nodes/OutputNode.tsx');
  const uploadNode = read('../src/components/nodes/UploadNode.tsx');

  assert.match(modal, /onProduce:\s*\(urls: string\[\], meta: ImageEditProduceMeta\) => void \| Promise<void>/);
  assert.match(modal, /await onProduce\(\[url\], \{ type: 'brush', strokeCount: brushStrokes\.length \}\);\s*onClose\(\);/);
  assert.match(modal, /await onProduce\(\[originUrl, annotatedUrl\], \{[\s\S]*type: 'annotation-edit'[\s\S]*\}\);\s*onClose\(\);/);

  assert.match(outputNode, /return queueAnnotationEditProduce\(cleanUrls, _meta\);/);
  assert.match(uploadNode, /return queueAnnotationEditProduce\(cleanUrls, _meta\);/);
  assert.match(outputNode, /if \(_meta\?\.type === 'annotation-edit'\) \{\s*return queueAnnotationEditProduce\(cleanUrls, _meta\);\s*\}\s*if \(cleanUrls\.length === 0\)/);
  assert.match(uploadNode, /if \(_meta\?\.type === 'annotation-edit'\) \{\s*return queueAnnotationEditProduce\(cleanUrls, _meta\);\s*\}\s*if \(cleanUrls\.length === 0\)/);
  assert.match(outputNode, /actionId: 'image-edit\.annotation'/);
  assert.match(uploadNode, /actionId: 'image-edit\.annotation'/);
  assert.match(outputNode, /resolveSecondaryProviderActionForRun/);
  assert.match(uploadNode, /resolveSecondaryProviderActionForRun/);
  assert.match(outputNode, /logBus\.error\(error\?\.message \|\| t\('nodes:output\.errors\.annotationFailed'\), logSource\);/);
  assert.match(uploadNode, /logBus\.error\(error\?\.message \|\| '标注改图失败', logSource\);/);
  assert.match(outputNode, /if \(providerRequested && !providerResponded\) \{\s*await reporter\.providerResponse\([\s\S]*?throw error;/);
  assert.match(uploadNode, /if \(providerRequested && !providerResponded\) \{\s*await reporter\.providerResponse\([\s\S]*?throw error;/);
});

test('Cowart-inspired workflow is wired through node registry, toolbar, canvas, themes, and docs', () => {
  const toolbar = read('../src/components/CanvasToolbar.tsx');
  const canvas = read('../src/components/Canvas.tsx');
  const targetNode = read('../src/components/nodes/GenerationTargetNode.tsx');
  const outputNode = read('../src/components/nodes/OutputNode.tsx');
  const uploadNode = read('../src/components/nodes/UploadNode.tsx');
  const upstreamMaterials = read('../src/components/nodes/useUpstreamMaterials.ts');
  const mediaCollection = read('../src/utils/mediaCollection.ts');
  const css = read('../src/styles/index.css');
  const features = read('../features.json');

  assertProductionNodeSchema('generation-target', {
    label: '生成目标框',
    category: 'input',
    inputs: ['text', 'image'],
    outputs: ['image'],
    executable: false,
  });

  assert.match(toolbar, /onCreateGenerationTarget:\s*\(\)\s*=>\s*void/);
  assert.match(toolbar, /t\('toolbar\.generationTargetDetail'\)/);
  assert.match(toolbar, /onExportResourcePackage:\s*\(\)\s*=>\s*void/);
  assert.match(toolbar, /t\('toolbar\.exportResources/);
  assert.match(toolbar, /PackageOpen/);
  assert.doesNotMatch(toolbar, /aria-label="导出资源包"[\s\S]{0,160}<Archive size=\{15\}/);

  assert.match(canvas, /GenerationTargetNode/);
  assert.match(canvas, /handleCreateGenerationTarget/);
  assert.match(canvas, /handleExportResourcePackage/);
  assert.match(canvas, /collectCanvasSelectionSummary/);
  assert.match(canvas, /buildCreativeTargetResult/);
  assert.match(canvas, /prepareCanvasResourcePackageImport/);
  assert.match(canvas, /generationHistory:\s*generationHistoryForExport/);
  assert.match(canvas, /resourceLibrary:\s*resourceLibrarySnapshot/);

  assert.match(targetNode, /替换到框内/);
  assert.match(targetNode, /保留版本/);
  assert.match(targetNode, /generateImage/);
  assert.match(targetNode, /creativeTargetId/);
  assert.match(targetNode, /Download/);
  assert.match(targetNode, /className="t8-generation-target-download nodrag nopan"/);
  assert.match(targetNode, /download/);
  assert.doesNotMatch(targetNode, /className=\{`t8-generation-target-node\s+nodrag/);
  assert.match(targetNode, /className="t8-generation-target-title nodrag"/);
  assert.match(targetNode, /className="t8-generation-target-prompt nodrag nowheel"/);
  assert.match(upstreamMaterials, /data\.resultUrl/);
  assert.match(upstreamMaterials, /'resultUrls'/);
  assert.match(mediaCollection, /data\.resultUrl/);
  assert.match(mediaCollection, /data\.resultUrls/);

  assert.match(outputNode, /buildAnnotationEditRequest/);
  assert.match(outputNode, /buildAnnotationEditResultPlacement/);
  assert.match(outputNode, /generateImage/);
  assert.match(outputNode, /_meta\?\.type === 'annotation-edit'/);
  assert.match(uploadNode, /buildAnnotationEditRequest/);
  assert.match(uploadNode, /buildAnnotationEditResultPlacement/);
  assert.match(uploadNode, /generateImage/);
  assert.match(uploadNode, /_meta\?\.type === 'annotation-edit'/);

  assert.match(css, /Generation target node v1/);
  assert.match(css, /\.t8-generation-target-download/);
  assert.match(css, /\[data-theme-visual="farm-story"\] \.t8-generation-target-node/);
  assert.match(css, /\[data-theme-visual="saint-seiya"\] \.t8-generation-target-node/);

  assert.match(features, /cowartInspiredCanvasWorkflow/);
});
