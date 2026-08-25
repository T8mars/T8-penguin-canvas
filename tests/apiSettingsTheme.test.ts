import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { enUS, zhCN } from '../src/i18n/resources.ts';

const apiSettingsSource = readFileSync(new URL('../src/components/ApiSettings.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');
const defaultTemplatesSource = readFileSync(new URL('../src/theme/defaultTemplates.ts', import.meta.url), 'utf8');
const themeStoreSource = readFileSync(new URL('../src/stores/theme.ts', import.meta.url), 'utf8');
const themeTemplateManagerSource = readFileSync(new URL('../src/components/ThemeTemplateManager.tsx', import.meta.url), 'utf8');
const featuresSource = readFileSync(new URL('../features.json', import.meta.url), 'utf8');

test('ApiSettings uses semantic theme classes for cross-theme readability', () => {
  const requiredClasses = [
    't8-api-settings-modal',
    't8-api-settings-body',
    't8-api-settings-toggle',
    't8-api-settings-badge',
    't8-api-settings-provider-card',
    't8-api-settings-provider-panel',
    't8-api-settings-section',
    't8-api-settings-guide',
    't8-api-settings-input',
  ];

  for (const className of requiredClasses) {
    assert.match(apiSettingsSource, new RegExp(className), `${className} should be used by ApiSettings`);
    assert.match(indexCss, new RegExp(`\\.${className}\\b`), `${className} should be defined in index.css after Tailwind utilities`);
  }
});

test('ApiSettings theme CSS is backed by T8 tokens instead of hard-coded white panels', () => {
  const cssBlock = indexCss.slice(indexCss.indexOf('/* API settings semantic theme adapter */'));
  assert.ok(cssBlock.length > 0, 'API settings semantic theme adapter should exist');
  assert.match(cssBlock, /--t8-bg-panel/);
  assert.match(cssBlock, /--t8-text-main/);
  assert.match(cssBlock, /--t8-text-muted/);
  assert.match(cssBlock, /--t8-border/);
  assert.match(cssBlock, /--t8-accent/);
});

test('ApiSettings advanced provider fields stay mounted while typing and ModelScope exposes token links', () => {
  assert.doesNotMatch(
    apiSettingsSource,
    /const\s+FormBlock\s*=/,
    'advanced provider sections must not define a React component inside renderAdvancedProviderForm',
  );
  assert.match(apiSettingsSource, /function\s+AdvancedProviderFormBlock/);
  assert.match(apiSettingsSource, /https:\/\/www\.modelscope\.cn\/my\/access\/token/);
  assert.match(apiSettingsSource, /https:\/\/www\.modelscope\.ai\/my\/access\/token/);
  assert.match(apiSettingsSource, /t\('providerForm\.modelscope\.cnAction'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.modelscope\.intlAction'\)/);
  assert.match(apiSettingsSource, /t\('lora\.title'/);
  assert.equal(zhCN.settings.providerForm.modelscope.cnAction, '获取 Token · 国内');
  assert.equal(enUS.settings.providerForm.modelscope.cnAction, 'Get token · China');
  assert.equal(zhCN.settings.lora.title, '4. ModelScope LoRA（可选）');
  assert.equal(enUS.settings.lora.title, '4. ModelScope LoRA (optional)');
  assert.match(apiSettingsSource, /https:\/\/www\.modelscope\.cn\/aigc\/models/);
});

test('ApiSettings Jimeng CLI panel explains install, login, and executable path', () => {
  assert.match(apiSettingsSource, /t\('jimeng\.installTitle'\)/);
  assert.match(apiSettingsSource, /JIMENG_CLI_INSTALL_UPDATE_COMMAND/);
  assert.match(apiSettingsSource, /JIMENG_CLI_SUPPORTED_VERSION/);
  assert.match(apiSettingsSource, /t\('jimeng\.installBody'/);
  assert.match(apiSettingsSource, /t\('jimeng\.loginCommands'\)/);
  assert.match(apiSettingsSource, /t\('jimeng\.pathHelp'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.testConnection'\)/);
  assert.match(zhCN.settings.jimeng.installBody, /dreamina login/);
  assert.match(enUS.settings.jimeng.loginCommands, /dreamina user_credit/);
  assert.match(zhCN.settings.jimeng.loginCommands, /dreamina relogin/);
  assert.match(enUS.settings.jimeng.loginCommands, /dreamina logout/);
  assert.match(enUS.settings.jimeng.pathHelp, /C:\\Users\\<username>\\bin\\dreamina\.exe/);
});

test('ApiSettings ComfyUI panel supports workflow JSON upload and auto-mapping exclude rules', () => {
  assert.match(apiSettingsSource, /handleComfyWorkflowFile/);
  assert.match(apiSettingsSource, /t\('comfy\.upload'\)/);
  assert.match(apiSettingsSource, /applyComfySampleWorkflow/);
  assert.match(apiSettingsSource, /t\('comfy\.loadSample'\)/);
  assert.match(apiSettingsSource, /buildComfyWorkflowImportChecklist/);
  assert.match(apiSettingsSource, /t\('comfy\.excludeRules'\)/);
  assert.match(apiSettingsSource, /filterComfyFieldsByExcludeRules/);
  assert.match(apiSettingsSource, /parseComfyFieldExcludeRules/);
  assert.match(apiSettingsSource, /comfyExcludeRulesRaw/);
  assert.match(apiSettingsSource, /t\('comfy\.excludeSampler'\)/);
  assert.ok(zhCN.settings.comfy.excludeRules.length > 0);
  assert.ok(enUS.settings.comfy.excludeRules.length > 0);
});

test('ApiSettings Volcengine panel separates Ark API Key from AK/SK credentials', () => {
  assert.match(apiSettingsSource, /providers\.keyLabels\.volcengine/);
  assert.match(apiSettingsSource, /t\('providerForm\.enterArkKey'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.volc\.akTitle'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.volc\.akLabel'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.volc\.skLabel'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.volc\.whichKeyBody'\)/);
  assert.match(apiSettingsSource, /t\('providerForm\.volc\.seedanceReminder'\)/);
  assert.match(zhCN.settings.providerForm.volc.seedanceReminderBody, /doubao-seedance-2-0-260128/);
  assert.match(enUS.settings.providerForm.volc.seedanceReminderBody, /doubao-seedance-2-0-fast-260128/);
  assert.match(zhCN.settings.providerForm.volc.seedanceReminderBody, /ModelNotOpen \/ HTTP 404/);
  assert.match(enUS.settings.providerForm.volc.seedanceReminderBody, /ModelNotOpen \/ HTTP 404/);
});

test('ApiSettings classified API keys expose explicit clear actions', () => {
  assert.match(apiSettingsSource, /const \[clearedFields, setClearedFields\]/);
  assert.match(apiSettingsSource, /handleClearClassifiedKey/);
  assert.match(apiSettingsSource, /t\('keys\.pendingClear'\)/);
  assert.match(apiSettingsSource, /\(patch as any\)\[f\] = ''/);
  assert.match(apiSettingsSource, /t\('keys\.clearClassified'\)/);
  assert.match(apiSettingsSource, /aria-label=\{`\$\{t\(spec\.labelKey as any\)\}\$\{pendingClear \? t\('keys\.cancelClear'\) : t\('keys\.clear'\)\}`\}/);
  assert.equal(zhCN.settings.keys.pendingClear, '保存后清空');
  assert.equal(enUS.settings.keys.pendingClear, 'Will clear on save');
});

test('ApiSettings exposes an independent fixed seedance.nz main API key', () => {
  assert.match(apiSettingsSource, /labelKey: 'keys\.zhenzhenBudget\.label'/);
  assert.match(apiSettingsSource, /labelKey: 'keys\.zhenzhen\.label'/);
  assert.match(apiSettingsSource, /FIXED_ZHENZHEN_SD2_BASE/);
  assert.match(apiSettingsSource, /https:\/\/api\.seedance\.nz\/sign-up\?aff=ibVH/);
  assert.match(apiSettingsSource, /zhenzhenSd2ApiKey/);
  assert.match(apiSettingsSource, /clearable: true/);
  assert.ok(zhCN.settings.keys.zhenzhenBudget.label.length > 0);
  assert.ok(enUS.settings.keys.zhenzhenBudget.label.length > 0);
});

test('ApiSettings cloud upload panels link to vendor consoles and secret key reminders', () => {
  assert.match(apiSettingsSource, /https:\/\/console\.cloud\.tencent\.com\/cam\/capi/);
  assert.match(apiSettingsSource, /https:\/\/console\.cloud\.tencent\.com\/lighthouse\/cos\/index\?rid=5/);
  assert.match(apiSettingsSource, /t\('cloudForm\.tencent\.reminder'\)/);
  assert.match(apiSettingsSource, /https:\/\/ram\.console\.aliyun\.com\/manage\/ak/);
  assert.match(apiSettingsSource, /https:\/\/oss\.console\.aliyun\.com\/bucket/);
  assert.match(apiSettingsSource, /t\('cloudForm\.aliyun\.reminder'\)/);
  assert.match(zhCN.settings.cloudForm.tencent.reminder, /SecretKey/);
  assert.match(enUS.settings.cloudForm.tencent.reminder, /SecretKey/);
  assert.match(zhCN.settings.cloudForm.aliyun.reminder, /AccessKey Secret/);
  assert.match(enUS.settings.cloudForm.aliyun.reminder, /AccessKey Secret/);
});

test('ApiSettings exposes custom task completion sound upload without bypassing theme classes', () => {
  assert.match(apiSettingsSource, /t\('sound\.title'\)/);
  assert.match(apiSettingsSource, /handleTaskCompletionSoundUpload/);
  assert.match(apiSettingsSource, /uploadTaskCompletionSound/);
  assert.match(apiSettingsSource, /resetTaskCompletionSound/);
  assert.match(apiSettingsSource, /accept="audio\/\*,\.mp3,\.wav,\.ogg,\.m4a,\.aac,\.flac,\.webm"/);
  assert.match(apiSettingsSource, /t\('sound\.test'\)/);
  assert.match(apiSettingsSource, /t\('sound\.restoreDefault'\)/);
  assert.match(apiSettingsSource, /t8-api-settings-section/);
  assert.match(apiSettingsSource, /t8-api-settings-secondary-btn/);
});

test('UI font preference resolves readable defaults and custom stacks', async () => {
  const fontModule = new URL('../src/utils/uiFont.ts', import.meta.url);

  assert.equal(existsSync(fontModule), true, 'uiFont utility should exist');
  const utils = await import('../src/utils/uiFont.ts');
  assert.equal(utils.DEFAULT_UI_FONT_PRESET, 'readable');
  assert.equal(utils.normalizeUiFontPresetId('missing'), 'readable');
  assert.match(utils.resolveUiFontStack('readable', ''), /Microsoft YaHei UI/);
  assert.match(utils.resolveUiFontStack('system', ''), /system-ui/);
  assert.equal(utils.resolveUiFontStack('theme', ''), '');
  assert.equal(utils.sanitizeCustomUiFont('  "霞鹜文楷", serif  '), '"霞鹜文楷", serif');
  assert.equal(utils.resolveUiFontStack('custom', '"霞鹜文楷", serif'), '"霞鹜文楷", serif');
});

test('ApiSettings exposes a persisted global UI font control', () => {
  assert.match(apiSettingsSource, /UI_FONT_PRESETS/);
  assert.match(apiSettingsSource, /t\('fonts\.title'\)/);
  assert.match(apiSettingsSource, /data-ui-font-settings="true"/);
  assert.match(apiSettingsSource, /data-ui-font-preset/);
  assert.match(apiSettingsSource, /t\('fonts\.previewTitle'\)/);
  assert.match(apiSettingsSource, /setUiFontPreset/);
  assert.match(apiSettingsSource, /setCustomUiFont/);
  assert.match(themeStoreSource, /uiFontPreset/);
  assert.match(themeStoreSource, /customUiFont/);
  assert.match(themeStoreSource, /setUiFontPreset/);
  assert.match(themeStoreSource, /resetUiFontPreference/);
  assert.match(appSource, /applyUiFontPreference/);
  assert.match(indexCss, /\.t8-ui-font-option/);
  assert.match(indexCss, /\.t8-ui-font-preview/);
});

test('Dragon Ball theme defaults to bundled mp3 music and packaging validates the asset', () => {
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const musicAsset = new URL('../src/assets/theme-music/dragonball-makafushigi-adventure.mp3', import.meta.url);
  const hiddenMusicAsset = new URL('../src/assets/theme-music/dragonball-shenron-cha-la-head-cha-la.mp3', import.meta.url);

  assert.equal(existsSync(musicAsset), true);
  assert.equal(existsSync(hiddenMusicAsset), true);
  assert.match(defaultTemplatesSource, /dragonBallThemeMusicUrl = new URL\('\.\.\/assets\/theme-music\/dragonball-makafushigi-adventure\.mp3'/);
  assert.match(defaultTemplatesSource, /dragonBallShenronHiddenMusicUrl = new URL\('\.\.\/assets\/theme-music\/dragonball-shenron-cha-la-head-cha-la\.mp3'/);
  assert.match(defaultTemplatesSource, /id: DRAGON_BALL_TEMPLATE_ID[\s\S]*source: 'url'[\s\S]*url: dragonBallThemeMusicUrl/);
  assert.match(defaultTemplatesSource, /title: '摩诃不思议 Adventure'/);
  assert.match(defaultTemplatesSource, /hiddenTitle: 'CHA-LA HEAD-CHA-LA'/);
  assert.match(defaultTemplatesSource, /hiddenUrl: dragonBallShenronHiddenMusicUrl/);
  assert.match(themeTemplateManagerSource, /dragonBallThemeMusicUrl/);
  assert.match(themeTemplateManagerSource, /dragonBallShenronHiddenMusicUrl/);
  assert.match(themeTemplateManagerSource, /visualStyle === 'dragon-ball'[\s\S]*source: 'url'[\s\S]*url: dragonBallThemeMusicUrl/);
  assert.match(themeTemplateManagerSource, /visualStyle === 'dragon-ball'[\s\S]*hiddenUrl: dragonBallShenronHiddenMusicUrl/);
  assert.match(postBuild, /checkFrontendAsset\('dragonball-makafushigi-adventure-', '\.mp3'\)/);
  assert.match(postBuild, /checkFrontendAsset\('dragonball-shenron-cha-la-head-cha-la-', '\.mp3'\)/);
  assert.match(featuresSource, /"dragon-ball-style": "dragonball-makafushigi-adventure\.mp3"/);
  assert.match(featuresSource, /"dragon-ball-shenron-hidden": "dragonball-shenron-cha-la-head-cha-la\.mp3"/);
});

test('Saint Seiya theme defaults to bundled sanctuary and Hades mp3 music', () => {
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const musicAsset = new URL('../src/assets/theme-music/saint-seiya-pegasus-fantasy.mp3', import.meta.url);
  const hiddenMusicAsset = new URL('../src/assets/theme-music/saint-seiya-hades-last-holy-war.mp3', import.meta.url);

  assert.equal(existsSync(musicAsset), true);
  assert.equal(existsSync(hiddenMusicAsset), true);
  assert.match(defaultTemplatesSource, /saintSeiyaThemeMusicUrl = new URL\('\.\.\/assets\/theme-music\/saint-seiya-pegasus-fantasy\.mp3'/);
  assert.match(defaultTemplatesSource, /saintSeiyaHadesThemeMusicUrl = new URL\('\.\.\/assets\/theme-music\/saint-seiya-hades-last-holy-war\.mp3'/);
  assert.match(defaultTemplatesSource, /id: SAINT_SEIYA_TEMPLATE_ID[\s\S]*source: 'url'[\s\S]*url: saintSeiyaThemeMusicUrl/);
  assert.match(defaultTemplatesSource, /hiddenUrl: saintSeiyaHadesThemeMusicUrl/);
  assert.match(themeTemplateManagerSource, /saintSeiyaThemeMusicUrl/);
  assert.match(themeTemplateManagerSource, /visualStyle === 'saint-seiya'[\s\S]*source: 'url'[\s\S]*url: saintSeiyaThemeMusicUrl/);
  assert.match(themeTemplateManagerSource, /visualStyle === 'saint-seiya'[\s\S]*hiddenUrl: saintSeiyaHadesThemeMusicUrl/);
  assert.match(postBuild, /checkFrontendAsset\('saint-seiya-pegasus-fantasy-', '\.mp3'\)/);
  assert.match(postBuild, /checkFrontendAsset\('saint-seiya-hades-last-holy-war-', '\.mp3'\)/);
  assert.match(postBuild, /film-tech-01\.mp4\.t8media/);
  assert.match(postBuild, /film-rh-01\.mp4\.t8media/);
  assert.match(postBuild, /film-yyh-01\.mp4\.t8media/);
  assert.match(postBuild, /film-dragon-ball-01\.mp4\.t8media/);
  assert.match(postBuild, /film-saint-seiya-01\.mp4\.t8media/);
  assert.match(postBuild, /film-tetris-01\.mp4\.t8media/);
  assert.match(featuresSource, /"saint-seiya-style": "saint-seiya-pegasus-fantasy\.mp3"/);
  assert.match(featuresSource, /"saint-seiya-hades-hidden": "saint-seiya-hades-last-holy-war\.mp3"/);
});
