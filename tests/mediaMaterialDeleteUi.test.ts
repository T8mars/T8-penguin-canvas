import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('upload and output material nodes expose per-material delete actions', () => {
  const upload = read('../src/components/nodes/UploadNode.tsx');
  const output = read('../src/components/nodes/OutputNode.tsx');

  assert.match(upload, /Trash2/);
  assert.match(output, /Trash2/);
  assert.match(upload, /createUploadMediaRemovalData/);
  assert.match(output, /createOutputMediaRemovalData/);
  assert.match(output, /isMaterialUrlHidden/);
  assert.match(upload, /handleRemoveUploadItem/);
  assert.match(output, /handleRemoveOutputMaterial/);
  assert.match(upload, /删除素材/);
  assert.match(output, /t\('nodes:output\.removeMaterial'/);
  assert.match(upload, /group-hover\/upload-image/);
  assert.match(output, /group-hover\/output-image-card/);
  assert.match(output, /t8-output-image-action-stack/);
  assert.match(output, /t8-output-image-action-stack--compact/);
  assert.match(output, /t8-output-image-action-stack--above/);
  assert.match(output, /t8-output-image-media--grid/);
  assert.match(output, /resolveOutputGridColumns/);
  assert.match(output, /gridTemplateColumns: `repeat\(\$\{imageGridColumns\}, minmax\(0, 1fr\)\)`/);
  assert.match(output, /t8-material-action-button/);
  assert.match(output, /iconSize=\{displayImageUrls\.length >= 2 \? 10 : 14\}/);

  const css = read('../src/styles/index.css');
  assert.match(css, /\.t8-output-image-media--grid\s*\{[\s\S]*height:\s*auto\s*!important/);
  assert.match(css, /\.t8-output-image-media--grid\s*\{[\s\S]*object-fit:\s*contain\s*!important/);
  assert.match(css, /\.t8-output-image-action-stack--compact\s*\{[\s\S]*flex-direction:\s*row\s*!important/);
  assert.match(css, /\.t8-output-image-action-stack--above\s*\{[\s\S]*position:\s*relative\s*!important/);
  assert.match(css, /\.t8-output-image-action-stack--compact\s+\.t8-material-action-button\s*\{[\s\S]*width:\s*22px\s*!important/);
  assert.match(css, /\.t8-output-image-action-stack--compact\s+\.t8-material-action-button\s*\{[\s\S]*height:\s*22px\s*!important/);
  assert.match(css, /\.t8-output-image-action-stack--compact\s+\.t8-material-action-button\s*\{[\s\S]*min-height:\s*22px\s*!important/);
});

test('upload material node exposes a download action in the node controls', () => {
  const upload = read('../src/components/nodes/UploadNode.tsx');

  assert.match(upload, /function uploadDownloadName/);
  assert.match(upload, /const handleDownloadUploads/);
  assert.match(upload, /data-upload-action="download"/);
  assert.match(upload, /title=\{mediaItems\.length > 1 \? '下载全部素材' : '下载素材'\}/);
  assert.match(upload, /aria-label=\{mediaItems\.length > 1 \? '下载全部素材' : '下载素材'\}/);
  assert.match(upload, /uploadDownloadName\(item, i\)/);
  assert.match(upload, /document\.createElement\('a'\)/);
  assert.match(upload, /<Download size=\{11\} \/>/);

  assert.ok(
    upload.indexOf('data-upload-action="download"') < upload.indexOf('title="继续添加同类型文件"'),
    'download action should appear before the existing add-more upload button',
  );
});

test('image material context menu can copy the actual image to clipboard', () => {
  const contextMenu = read('../src/components/MaterialContextMenu.tsx');
  const clipboardUtil = read('../src/utils/imageClipboard.ts');

  assert.match(contextMenu, /copyImageUrlToClipboard/);
  assert.match(contextMenu, /复制图片到剪切板/);
  assert.match(contextMenu, /图片已复制到剪切板/);
  assert.match(contextMenu, /menu\.kind === 'image'/);

  assert.match(clipboardUtil, /export async function copyImageUrlToClipboard/);
  assert.match(clipboardUtil, /navigator\.clipboard\.write/);
  assert.match(clipboardUtil, /ClipboardItem/);
  assert.match(clipboardUtil, /image\/png/);
  assert.match(clipboardUtil, /canvas\.toBlob/);
});

test('image material context menu can send the current image to Photoshop', () => {
  const contextMenu = read('../src/components/MaterialContextMenu.tsx');

  assert.match(contextMenu, /sendToPhotoshop/);
  assert.match(contextMenu, /发送到 Photoshop/);
  assert.match(contextMenu, /正在发送到 Photoshop/);
  assert.match(contextMenu, /已发送到 Photoshop/);
  assert.match(contextMenu, /Photoshop 面板队列/);
  assert.match(contextMenu, /请查看 PS 面板置入状态/);
  assert.match(contextMenu, /menu\.kind !== 'image' \|\| !menu\.url/);
  assert.match(contextMenu, /kind:\s*'image'/);
  assert.match(contextMenu, /url:\s*menu\.url/);
  assert.match(contextMenu, /name:\s*menu\.title \|\| baseName\(menu\.url\)/);
  assert.match(contextMenu, /sourceCanvasId:\s*activeCanvasId \|\| undefined/);
  assert.match(contextMenu, /sourceLabel:\s*'画布右键图片'/);
  assert.match(contextMenu, /disabled=\{sendingToPhotoshop\}/);
});
