import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

test('Dragon Ball radar keeps the minimap marker until successful collection and plays feedback', () => {
  const radar = read('../src/components/DragonBallRadar.tsx');
  const store = read('../src/stores/dragonBallRadar.ts');
  const css = read('../src/styles/theme-dragonball.css');

  assert.match(store, /DRAGON_BALL_SPAWN_INTERVAL_MS\s*=\s*60_000/);
  assert.match(store, /DRAGON_BALL_SPAWN_VISIBLE_MS\s*=\s*5_000/);
  assert.match(store, /DRAGON_BALL_COLLECT_TTL_MS\s*=\s*15\s*\*\s*60_000/);
  assert.match(store, /DRAGON_BALL_HOLD_TO_COLLECT_MS\s*=\s*3_000/);
  assert.match(store, /trackingActiveSpawn/);
  assert.match(store, /activeSpawn[\s\S]*trackingActiveSpawn[\s\S]*\?/);
  assert.match(store, /sameDragonBallCollection/);
  assert.match(store, /sameCollected && state\.activeSpawn === activeSpawn/);
  assert.match(store, /target\.progressMs === nextProgressMs && target\.startedAt === startedAt/);
  assert.match(store, /beginTracking\(spawn\)[\s\S]*activeSpawn:\s*\{/);
  assert.match(store, /collectTracked[\s\S]*activeSpawn:\s*null/);

  assert.match(radar, /radarRuntimeRef/);
  assert.match(radar, /const snapshot = radarRuntimeRef\.current/);
  assert.match(radar, /data-star=\{star\}/);
  assert.match(radar, /data-index=\{index \+ 1\}/);
  assert.match(radar, /playDragonBallCollectSound/);
  assert.match(radar, /setCollectFeedback\(\{\s*star:\s*result\.star/);
  assert.match(radar, /DRAGON_BALL_RADAR_COLLAPSED_STORAGE_KEY/);
  assert.match(radar, /t8-dragonball-radar__toolbar-toggle/);
  assert.match(radar, /t8-dragonball-radar__map-layer/);
  assert.match(radar, /data-dragonball-radar-collapsed/);
  assert.match(radar, /window\.localStorage\.setItem\(DRAGON_BALL_RADAR_COLLAPSED_STORAGE_KEY/);
  assert.match(radar, /className=\{`t8-dragonball-radar__ping \$\{trackingTarget\?\.star === activeSpawn\.star \? 'is-tracking' : ''\}`\}/);
  assert.match(radar, /style=\{\{ left: `\$\{activeSpawn\.mapX\}%`, top: `\$\{activeSpawn\.mapY\}%` \}\}/);
  assert.match(radar, /if \(!trackingTarget\) handleSpawnClick\(\)/);
  assert.match(radar, /type:\s*'hidden_mode\.enabled'[\s\S]*kind:\s*'dragon-ball-shenron'/);
  assert.match(radar, /kind:\s*'dragon-ball-shenron'[\s\S]*mode:\s*'enabled'/);

  assert.match(css, /data-dragonball-mode="shenron"/);
  assert.match(css, /\.t8-dragonball-radar__feedback/);
  assert.match(css, /\.t8-dragonball-radar__map-layer/);
  assert.match(css, /\.t8-dragonball-radar__ping\.is-tracking/);
  const pingKeyframes = css.match(/@keyframes db-radar-ping \{([\s\S]*?)\n\}/);
  assert.ok(pingKeyframes, 'radar ping keyframes should exist');
  assert.doesNotMatch(pingKeyframes[1], /translate\(-50%, -50%\)/);
  assert.match(pingKeyframes[1], /scale:\s*1\.12/);
});

test('Dragon Ball radar lives in the toolbar and uses classic star layouts', () => {
  const css = read('../src/styles/theme-dragonball.css');
  const toolbar = read('../src/components/CanvasToolbar.tsx');
  const canvas = read('../src/components/Canvas.tsx');
  const root = css.match(/\.t8-dragonball-radar \{([\s\S]*?)\n\}/);
  const panel = css.match(/\.t8-dragonball-radar__panel \{([\s\S]*?)\n\}/);
  assert.ok(root, 'radar root css block should exist');
  assert.ok(panel, 'radar panel css block should exist');
  assert.match(toolbar, /children\?: ReactNode/);
  assert.match(toolbar, /endControl\?: ReactNode/);
  assert.match(toolbar, /\{children\}/);
  const childrenIndex = toolbar.indexOf('{children}');
  const terminalIndex = toolbar.indexOf('<TerminalIcon size={15} />');
  const endControlIndex = toolbar.indexOf('{endControl}', terminalIndex);
  assert.ok(childrenIndex >= 0 && terminalIndex > childrenIndex);
  assert.ok(endControlIndex > terminalIndex, 'the toolbar tail control must stay directly after terminal');
  assert.match(canvas, /<CanvasToolbar[\s\S]*<DragonBallRadar[\s\S]*<\/CanvasToolbar>/);
  assert.match(root[1], /position:\s*relative/);
  assert.match(root[1], /height:\s*32px/);
  assert.doesNotMatch(root[1], /bottom:\s*34px/);
  assert.doesNotMatch(root[1], /right:\s*28px/);
  assert.match(panel[1], /box-sizing:\s*border-box/);
  assert.match(panel[1], /width:\s*208px/);
  assert.match(panel[1], /top:\s*calc\(100% \+ 10px\)/);
  assert.doesNotMatch(panel[1], /bottom:\s*calc/);
  assert.doesNotMatch(panel[1], /width:\s*270px/);
  assert.match(css, /\.t8-dragonball-radar__map-layer \{[\s\S]*?right:\s*28px[\s\S]*?bottom:\s*34px[\s\S]*?width:\s*192px[\s\S]*?height:\s*192px/);
  assert.match(css, /\.t8-dragonball-radar__map-layer \.t8-dragonball-radar__ping \{[\s\S]*?position:\s*absolute[\s\S]*?transform:\s*translate\(-50%, -50%\)/);

  assert.match(css, /\.t8-dragonball-orb\[data-star="1"\][\s\S]*left:\s*50%[\s\S]*top:\s*50%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="4"\][\s\S]*nth-child\(2\)[\s\S]*left:\s*65%[\s\S]*top:\s*32%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="4"\][\s\S]*nth-child\(3\)[\s\S]*left:\s*35%[\s\S]*top:\s*68%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="5"\][\s\S]*nth-child\(3\)[\s\S]*left:\s*50%[\s\S]*top:\s*50%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="7"\][\s\S]*nth-child\(3\)[\s\S]*left:\s*30%[\s\S]*top:\s*50%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="7"\][\s\S]*nth-child\(4\)[\s\S]*left:\s*50%[\s\S]*top:\s*50%/);
  assert.match(css, /\.t8-dragonball-orb\[data-star="7"\][\s\S]*nth-child\(5\)[\s\S]*left:\s*70%[\s\S]*top:\s*50%/);
});

test('Dragon Ball Shenron mode can be toggled back from the topbar after unlock', () => {
  const app = read('../src/App.tsx');
  const resources = read('../src/i18n/resources.ts');
  const store = read('../src/stores/dragonBallRadar.ts');
  const css = read('../src/styles/theme-dragonball.css');

  assert.match(app, /useDragonBallRadarStore/);
  assert.match(app, /shenronUnlockedAt/);
  assert.match(app, /shenronModeActive/);
  assert.match(app, /t8-dragonball-mode-switch/);
  assert.match(app, /handleDragonBallModeSwitch\(false\)/);
  assert.match(app, /handleDragonBallModeSwitch\(true\)/);
  assert.match(app, /t\('shell:themeModes\.dragonBallTitle'\)/);
  assert.match(app, /t\('shell:themeModes\.shenronTitle'\)/);
  assert.match(resources, /dragonBallTitle:\s*'切回七龙珠普通模式'/);
  assert.match(resources, /shenronTitle:\s*'切换到神龙隐藏模式'/);
  assert.match(app, /import\.meta\.env\.DEV[\s\S]*t8DragonBalls/);
  assert.match(store, /seedDragonBallRadarForShenronTest/);
  assert.match(store, /nextSpawnAt:\s*now \+ 1_000/);
  assert.match(css, /\.t8-dragonball-mode-switch \{/);
  assert.match(css, /\.t8-dragonball-mode-switch__option\.is-active/);
});

test('Dragon Ball radar intervals do not depend on mutable store objects', () => {
  const radar = read('../src/components/DragonBallRadar.tsx');
  const spawnEffect = radar.match(
    /const timer = window\.setInterval\(\(\) => \{[\s\S]*?\}, 1000\);\s*return \(\) => window\.clearInterval\(timer\);\s*\}, \[([\s\S]*?)\]\);/,
  );
  assert.ok(spawnEffect, 'spawn interval effect should be easy to audit');
  const deps = spawnEffect[1];
  assert.doesNotMatch(deps, /\bactiveSpawn\b/);
  assert.doesNotMatch(deps, /\bcollected\b/);
  assert.doesNotMatch(deps, /\btrackingTarget\b/);
  assert.doesNotMatch(deps, /\bnextSpawnAt\b/);
  assert.doesNotMatch(deps, /\bshenronModeActive\b/);
  assert.doesNotMatch(deps, /\bshenronUnlockedAt\b/);
  assert.doesNotMatch(deps, /\bviewportMoving\b/);
  assert.doesNotMatch(deps, /\bnodeDragging\b/);
});

test('Dragon Ball hidden music uses bundled CHA-LA HEAD-CHA-LA with Shenron synth fallback', () => {
  const types = read('../src/theme/types.ts');
  const music = read('../src/components/ThemeMusicToggle.tsx');
  const defaults = read('../src/theme/defaultTemplates.ts');
  const assetUrl = new URL('../src/assets/theme-music/dragonball-shenron-cha-la-head-cha-la.mp3', import.meta.url);

  assert.equal(existsSync(assetUrl), true, 'Shenron hidden music should be checked into src/assets');
  assert.match(types, /'shenron-aura'/);
  assert.match(music, /useDragonBallRadarStore/);
  assert.match(music, /shenronHiddenMusicActive/);
  assert.match(music, /preset:\s*'shenron-aura'/);
  assert.match(music, /source:\s*\(base\?\.hiddenUrl \? 'url' : 'synth'\)/);
  assert.match(music, /url:\s*base\?\.hiddenUrl/);
  assert.match(defaults, /dragonBallShenronHiddenMusicUrl/);
  assert.match(defaults, /hiddenTitle:\s*'CHA-LA HEAD-CHA-LA'/);
  assert.match(defaults, /hiddenUrl:\s*dragonBallShenronHiddenMusicUrl/);
});

test('Dragon Ball Shenron hidden skin owns readable light and dark palettes', () => {
  const css = read('../src/styles/theme-dragonball.css');

  assert.match(css, /data-dragonball-mode="shenron"\]\[data-theme-mode="light"\]\s*\{[\s\S]*?--db-page-bg:\s*#d9fff3/);
  assert.match(css, /data-dragonball-mode="shenron"\]\[data-theme-mode="light"\]\s*\{[\s\S]*?--db-canvas-bg:\s*#baf4e6/);
  assert.match(css, /data-dragonball-mode="shenron"\]\[data-theme-mode="dark"\]\s*\{[\s\S]*?--db-page-bg:\s*#031014/);
  assert.match(css, /--db-input-bg/);
  assert.match(css, /--db-header-text/);
  assert.match(css, /--db-label-text/);
  assert.match(css, /\.t8-sidebar \{[\s\S]*?var\(--db-sidebar-bg\)[\s\S]*?var\(--db-sidebar-bg-2\)/);
  assert.match(css, /\.t8-topbar \{[\s\S]*?var\(--db-header-bg\)[\s\S]*?var\(--db-header-bg-2\)/);
  assert.match(css, /\.t8-canvas-shell \{[\s\S]*?background:\s*var\(--db-radar-bg\)/);
  assert.match(css, /input,\s*\nhtml\[data-theme-visual="dragon-ball"\]\[data-dragonball-mode="shenron"\] textarea[\s\S]*?background:\s*var\(--db-input-bg\)/);
  assert.match(css, /\.t8-node-header \.text-white[\s\S]*?color:\s*var\(--db-header-text\)/);
  assert.match(css, /\.t8-node-header \.text-xs[\s\S]*?color:\s*var\(--db-header-muted\)/);
});

test('Dragon Ball Shenron cutscene uses the project dragon asset instead of CSS line art', () => {
  const css = read('../src/styles/theme-dragonball.css');
  const assetUrl = new URL('../src/assets/theme-dragonball/shenron-dragon.png', import.meta.url);
  const dragonBlock = css.match(/\.t8-dragonball-shenron-cutscene__dragon \{([\s\S]*?)\n\}/);

  assert.equal(existsSync(assetUrl), true, 'Shenron dragon asset should be checked into src/assets');
  assert.ok(dragonBlock, 'Shenron dragon css block should be easy to audit');
  assert.match(dragonBlock[1], /shenron-dragon\.png/);
  assert.match(dragonBlock[1], /center \/ contain no-repeat/);
  assert.doesNotMatch(dragonBlock[1], /\bborder:\s*5px solid/);
  assert.doesNotMatch(dragonBlock[1], /border-left-color/);
  assert.match(css, /@keyframes db-cutscene-radar-sweep/);
  assert.match(css, /@keyframes db-cutscene-portal/);
  assert.match(css, /@keyframes db-cutscene-beam/);
  assert.match(css, /prefers-reduced-motion[\s\S]*t8-dragonball-shenron-cutscene::before/);
  assert.match(css, /prefers-reduced-motion[\s\S]*t8-dragonball-shenron-cutscene__dragon::after/);
});
