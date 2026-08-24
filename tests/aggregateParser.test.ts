import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { assertProductionNodeSchema } from './helpers/canvasNodeSchema.ts';

const require = createRequire(import.meta.url);
const path = require('node:path');
const config = require('../backend/src/config.js');
const parseHubBridge = require('../backend/src/utils/parseHubBridge.js');

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

test('aggregate parser node is registered in toolbox with media ports', () => {
  const types = read('src/types/canvas.ts');
  const canvas = read('src/components/Canvas.tsx');
  const placement = read('src/utils/nodePlacement.ts');
  const loop = read('src/components/nodes/LoopNode.tsx');

  assertProductionNodeSchema('aggregate-parser', {
    label: '聚合解析',
    category: 'toolbox',
    inputs: ['text'],
    outputs: ['text', 'image', 'video', 'audio'],
    executable: true,
  });
  assert.match(types, /\|\s*'aggregate-parser'/);
  assert.match(canvas, /const AggregateParserNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/AggregateParserNode'\)/);
  assert.match(canvas, /'aggregate-parser':\s*AggregateParserNode/);
  assert.match(canvas, /'aggregate-parser':\s*\{[\s\S]*aggregateParserMode:\s*'download'/);
  assert.match(canvas, /'aggregate-parser':\s*\{[\s\S]*aggregateParserModeUserSet:\s*false/);
  assert.match(canvas, /'aggregate-parser':\s*\{[\s\S]*aggregateParserAcceptedCompliance:\s*false/);
  assert.match(loop, /import \{ EXECUTABLE_NODE_TYPES \} from '\.\.\/\.\.\/config\/executableNodeTypes'/);
  assert.match(placement, /'aggregate-parser':\s*\{\s*w:\s*620,\s*h:\s*680\s*\}/);
});

test('aggregate parser frontend enforces compliance and friendly controls', () => {
  const source = read('src/components/nodes/AggregateParserNode.tsx');

  assert.match(source, /合规使用确认/);
  assert.match(source, /acceptedCompliance/);
  assert.match(source, /请先勾选合规确认/);
  assert.match(source, /getAggregateParserStatus/);
  assert.match(source, /resolveAggregateMedia/);
  assert.match(source, /ParseHub/);
  assert.match(source, /解析并保存到输出目录/);
  assert.match(source, /只解析远端地址/);
  assert.match(source, /aggregateParserModeUserSet/);
  assert.match(source, /远端 CDN 链接可能需要平台请求头/);
  assert.match(source, /出现 403 不一定是解析失败/);
  assert.match(source, /代理 \/ Cookie/);
  assert.match(source, /授权助手/);
  assert.match(source, /normalizeCookieInput/);
  assert.match(source, /handleSaveAuth/);
  assert.match(source, /handleLoadSavedAuth/);
  assert.match(source, /desktopAuthAvailable/);
  assert.match(source, /浏览器手动模式/);
  assert.match(source, /桌面自动模式/);
  assert.match(source, /authSteps/);
  assert.match(source, /登录完成后回到本节点点击/);
  assert.match(source, /不需要手动复制 Cookie/);
  assert.match(source, /现在可以直接解析，也可以点击“保存授权”/);
  assert.match(source, /127\.0\.0\.1 页面不能跨站读取/);
  assert.match(source, /要自动获取，请使用 Electron 桌面端/);
  assert.match(source, /打开平台官网/);
  assert.match(source, /检查已粘贴 Cookie/);
  assert.match(source, /保存授权/);
  assert.match(source, /载入授权/);
  assert.match(source, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(source, /网页登录后本节点仍无法自动读取 Cookie/);
  assert.match(source, /手动 Cookie 格式看起来可用/);
  assert.match(source, /要自动检测，请在 Electron 桌面端打开画布/);
  assert.match(source, /粘贴 Cookie 后可直接用于本次解析，无需保存/);
  assert.match(source, /没有桌面端本机授权库/);
  assert.match(source, /noticeText = message \|\| savedError/);
  assert.doesNotMatch(source, /disabled=\{authBusy \|\| !authProfile\}/);
  assert.doesNotMatch(source, /disabled=\{authBusy \|\| !authProfile \|\| !savedAuth \|\| !electronParseAuth\?\.load\}/);
  assert.match(source, /aggregateParserCookie:\s*''/);
  assert.doesNotMatch(source, /onChange=\{\(e\) => update\(\{ aggregateParserCookie: e\.target\.value \}\)\}/);
});

test('aggregate parser auth helper profiles and Electron IPC are wired', () => {
  const helper = read('src/utils/parseAuth.ts');
  const service = read('src/services/parseHub.ts');
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');
  const viteEnv = read('src/vite-env.d.ts');
  const features = read('features.json');

  assert.match(helper, /PARSE_AUTH_PROFILES/);
  assert.match(helper, /detectParseAuthProfile/);
  assert.match(helper, /normalizeCookieInput/);
  assert.match(helper, /cookiePairsFromNetscape/);
  assert.match(service, /class AggregateParserApiError extends Error/);
  assert.match(service, /nextAction/);
  assert.match(preload, /parseAuth/);
  assert.match(preload, /t8pc:parse-auth:login/);
  assert.match(preload, /t8pc:parse-auth:get-cookie/);
  assert.match(preload, /t8pc:parse-auth:list-saved/);
  assert.match(preload, /t8pc:parse-auth:save/);
  assert.match(preload, /t8pc:parse-auth:load/);
  assert.match(preload, /t8pc:parse-auth:clear/);
  assert.match(main, /PARSE_AUTH_PARTITION = 'persist:t8-parsehub-auth'/);
  assert.match(main, /session\.fromPartition\(PARSE_AUTH_PARTITION\)/);
  assert.match(main, /safeStorage/);
  assert.match(main, /schema:\s*'t8-parsehub-auth'/);
  assert.match(main, /encryptParseAuthCookie/);
  assert.match(main, /isParseAuthAllowedUrl/);
  assert.match(main, /ipcMain\.handle\('t8pc:parse-auth:login'/);
  assert.match(main, /ipcMain\.handle\('t8pc:parse-auth:save'/);
  assert.match(main, /ipcMain\.handle\('t8pc:parse-auth:load'/);
  assert.match(viteEnv, /parseAuth\?:/);
  assert.match(features, /聚合解析授权体验/);
  assert.match(features, /本机授权库/);
});

test('aggregate parser backend is mounted and packaged', () => {
  const server = read('backend/src/server.js');
  const route = read('backend/src/routes/parseHub.js');
  const postBuild = read('electron/_post_build.cjs');
  const pkg = JSON.parse(read('package.json'));
  const distRelease = read('scripts/dist-release.cjs');

  assert.match(server, /const parseHubRouter = require\('\.\/routes\/parseHub'\)/);
  assert.match(server, /app\.use\('\/api\/parsehub', parseHubRouter\)/);
  assert.match(route, /acceptedCompliance !== true/);
  assert.match(route, /text === 'parse' \? 'parse' : 'download'/);
  assert.match(route, /classifyParseHubError/);
  assert.match(route, /runParseHubBridge/);
  assert.match(postBuild, /routes', 'parseHub\.t8c'/);
  assert.match(postBuild, /utils', 'parseHubBridge\.t8c'/);
  assert.match(postBuild, /tools', 'parsehub-bridge', 'parsehub_bridge\.py'/);
  assert.match(postBuild, /parsehub-pythonlibs\.zip/);
  assert.match(postBuild, /T8_REQUIRE_PARSEHUB_RUNTIME/);
  assert.match(distRelease, /T8_REQUIRE_PARSEHUB_RUNTIME/);
  assert.match(distRelease, /T8_REQUIRE_RUNTIME_ARCHIVES/);
  const resources = [...pkg.build.extraResources, ...pkg.build.win.extraResources]
    .map((item: any) => `${item.from}->${item.to}`);
  assert.ok(resources.includes('tools/parsehub-bridge->tools/parsehub-bridge'));
  assert.ok(resources.includes('tools/runtime-archives->tools/runtime-archives'));
  const archiveResource = pkg.build.win.extraResources.find((item: any) => item.to === 'tools/runtime-archives');
  assert.ok(archiveResource.filter.includes('parsehub-pythonlibs.zip'));
});

test('parsehub bridge classifies errors for actionable UI hints', () => {
  const login = parseHubBridge.classifyParseHubError(new Error('403 login required cookie expired'));
  assert.equal(login.code, 'login_required');
  assert.equal(login.status, 401);
  assert.match(login.hint, /授权助手|Cookie/);

  const timeout = parseHubBridge.classifyParseHubError(new Error('ParseHub 解析超时，请稍后重试或检查代理/Cookie'));
  assert.equal(timeout.code, 'parsehub_timeout');
  assert.equal(timeout.status, 504);

  const unsupported = parseHubBridge.classifyParseHubError(new Error('UnknownPlatform unsupported'));
  assert.equal(unsupported.code, 'unsupported_platform');
  assert.equal(unsupported.status, 400);
});

test('normalizeParseHubResult extracts remote and live-photo media links', () => {
  const result = parseHubBridge.normalizeParseHubResult({
    parsehubVersion: '2.0.24',
    pythonVersion: '3.12.9',
    parsed: {
      platform: 'douyin',
      platformName: '抖音',
      type: 'multimedia',
      title: 'demo title',
      content: 'demo content',
      raw_url: 'https://example.test/post/1',
      media: [
        { kind: 'video', url: 'https://cdn.example/video', ext: 'mp4', width: 720, height: 1280 },
        { kind: 'image', url: 'https://cdn.example/pic.jpg', ext: 'jpg', width: 1080, height: 1080 },
        { kind: 'image', url: 'https://cdn.example/live.jpg', ext: 'jpg', video_url: 'https://cdn.example/live.mp4', video_ext: 'mp4' },
      ],
    },
  });

  assert.equal(result.platformName, '抖音');
  assert.equal(result.media.length, 4);
  assert.deepEqual(result.media.map((item: any) => item.kind), ['video', 'image', 'image', 'video']);
  assert.match(result.outputText, /解析到的远端媒体地址/);
  assert.match(result.outputText, /出现 403 不一定代表解析错误/);
  assert.match(result.outputText, /合规提醒/);
});

test('normalizeParseHubResult prefers downloaded output files over remote CDN links', () => {
  const localPath = path.join(config.OUTPUT_DIR, 'parsehub', 'demo.mp4');
  const result = parseHubBridge.normalizeParseHubResult({
    parsehubVersion: '2.0.24',
    pythonVersion: '3.12.9',
    parsed: {
      platform: 'douyin',
      platformName: '抖音',
      type: 'video',
      title: 'download demo',
      raw_url: 'https://v.douyin.com/demo',
      media: [
        { kind: 'video', url: 'https://v26-web.douyinvod.com/temporary-video', ext: 'mp4' },
      ],
    },
    download: {
      output_dir: path.dirname(localPath),
      media: [
        { kind: 'video', path: localPath, ext: 'mp4' },
      ],
    },
  });

  assert.equal(result.mode, 'download');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].kind, 'video');
  assert.equal(result.media[0].source, 'download');
  assert.equal(result.media[0].url, '/files/output/parsehub/demo.mp4');
  assert.doesNotMatch(result.outputText, /douyinvod/);
  assert.match(result.outputText, /已保存到本地输出目录的媒体地址/);
});

test('parsehub runtime paths include bridge and generated dependency slot', () => {
  assert.match(parseHubBridge.resolveBridgeScript(), /parsehub-bridge[\\/]parsehub_bridge\.py$/);
  const libPaths = parseHubBridge.resolvePythonLibPaths();
  assert.ok(libPaths.some((p: string) => /ParseHub[\\/]src$/.test(p) || /parsehub-pythonlibs$/.test(p)));
  assert.ok(parseHubBridge.resolvePythonCandidates().some((item: any) => /python/i.test(item.command)));
});
