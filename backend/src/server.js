const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { startFigmaBridgeOnAppStart } = require('./utils/figmaBridge');

const app = express();

// ========== 中间件 ==========
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;
const UXP_ORIGIN_RE = /^uxp:\/\//i;
app.use(cors({
  origin(origin, cb) {
    cb(null, !origin || LOCAL_ORIGIN_RE.test(origin) || UXP_ORIGIN_RE.test(origin));
  },
}));
app.use(express.json({ limit: '120mb' }));
app.use(express.urlencoded({ extended: true, limit: '120mb' }));

// 简易访问日志
app.use((req, _res, next) => {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}] ${req.method} ${req.path}`);
  next();
});

// ========== 目录初始化 ==========
[
  config.DATA_DIR,
  config.INPUT_DIR,
  config.OUTPUT_DIR,
  config.THUMBNAILS_DIR,
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========== 静态资源托管 ==========
app.use('/files/output', express.static(config.OUTPUT_DIR));
app.use('/files/input', express.static(config.INPUT_DIR));
app.use('/files/thumbnails', express.static(config.THUMBNAILS_DIR));
app.use('/output', express.static(config.OUTPUT_DIR));
app.use('/input', express.static(config.INPUT_DIR));

// ========== 健康检查 ==========
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 't8-penguin-canvas-backend',
    version: config.APP_VERSION,
    port: config.PORT,
    time: new Date().toISOString(),
  });
});

// ========== 业务路由 ==========
const canvasRouter = require('./routes/canvas');
const settingsRouter = require('./routes/settings');
const proxyRouter = require('./routes/proxy');
const filesRouter = require('./routes/files');
const imageOpsRouter = require('./routes/imageOps');
const resourcesRouter = require('./routes/resources');
const themesRouter = require('./routes/themes');
const eagleRouter = require('./routes/eagle');
const figmaRouter = require('./routes/figma');
const externalProvidersRouter = require('./routes/externalProviders');
const grokOAuthRouter = require('./routes/grokOAuth');
const codexCliRouter = require('./routes/codexCli');
const aiWatermarkRouter = require('./routes/aiWatermark');
const cloudUploadsRouter = require('./routes/cloudUploads');
const parseHubRouter = require('./routes/parseHub');
const achievementsRouter = require('./routes/achievements');
const topazRouter = require('./routes/topaz');
const animeTagsRouter = require('./routes/animeTags');
const vibexBridgeRouter = require('./routes/vibexBridge');
const videoOpsRouter = require('./routes/videoOps');
const batchTagsRouter = require('./routes/batchTags');
const photoshopBridgeRouter = require('./routes/photoshopBridge');
const webAssetsRouter = require('./routes/webAssets');
const { registerLocalExtensions } = require('./extensions/localExtensions');
const localHooks = require('./extensions/runtimeHooks');

app.use('/api/canvas', canvasRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/proxy/external', externalProvidersRouter);
app.use('/api/files', filesRouter);
app.use('/api/image', imageOpsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/themes', themesRouter);
app.use('/api/eagle', eagleRouter);
app.use('/api/figma', figmaRouter);
app.use('/api/grok-oauth', grokOAuthRouter);
app.use('/api/codex-cli', codexCliRouter);
app.use('/api/ai-watermark', aiWatermarkRouter);
app.use('/api/cloud-uploads', cloudUploadsRouter);
app.use('/api/parsehub', parseHubRouter);
app.use('/api/achievements', achievementsRouter);
app.use('/api/topaz', topazRouter);
app.use('/api/anime-tags', animeTagsRouter);
app.use('/api/vibex-bridge', vibexBridgeRouter);
app.use('/api/video-ops', videoOpsRouter);
app.use('/api/batch-tags', batchTagsRouter);
app.use('/api/photoshop-bridge', photoshopBridgeRouter);
app.use('/api/web-assets', webAssetsRouter);
registerLocalExtensions(app, { config, express, logger: console, hooks: localHooks });

// ========== 前端静态资源(仅打包模式) ==========
// 开发模式下不启用,避免与 Vite dev server 打架。
if (config.IS_PACKAGED && config.FRONTEND_DIST && fs.existsSync(config.FRONTEND_DIST)) {
  app.use(express.static(config.FRONTEND_DIST));
  // SPA 兑底: 除了 /api/* 与 /files/* 外,其他路由返回 index.html(允许前端路由)
  app.get(/^\/(?!api\/|files\/|input\/|output\/).*/, (_req, res) => {
    res.sendFile(path.join(config.FRONTEND_DIST, 'index.html'));
  });
}

// ========== 启动 ==========
const PORT = config.PORT;
const HOST = config.HOST;

app.listen(PORT, HOST, () => {
  console.log('==================================================');
  console.log('🐧 T8-penguin-canvas 后端服务');
  console.log('==================================================');
  console.log(`🚀 服务器启动成功!`);
  console.log(`   地址: http://${HOST}:${PORT}`);
  console.log(`   环境: ${config.NODE_ENV}`);
  console.log(`   数据目录: ${config.DATA_DIR}`);
  console.log(`   输出目录: ${config.OUTPUT_DIR}`);
  console.log('   Figma Bridge: 自动启动中（如需禁用可设置 T8_FIGMA_BRIDGE_AUTOSTART=0）');
  console.log('   按 Ctrl+C 停止服务器...');
  console.log('--------------------------------------------------');
  startFigmaBridgeOnAppStart(console);
});
