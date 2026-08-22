import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Jimeng help keeps login, logout, update, and supported version in one shared contract', () => {
  const config = read('../src/config/jimengCli.ts');
  const help = read('../src/components/nodes/JimengCliHelpButton.tsx');
  const compatibility = JSON.parse(read('../backend/src/shared/jimengCliCompatibility.json'));

  assert.equal(compatibility.supportedVersion, '1.4.17');
  assert.equal(compatibility.releaseDate, '2026-08-18');
  assert.deepEqual(compatibility.seedance25.resolutions, ['480p', '720p', '1080p']);
  assert.deepEqual(compatibility.seedance25.duration, { min: 4, max: 30 });
  assert.deepEqual(compatibility.seedance25.commands, ['text2video', 'image2video', 'frames2video', 'multimodal2video']);
  assert.deepEqual(compatibility.seedance25.multimodal, {
    images: 30,
    videos: 10,
    audios: 10,
    total: 50,
    mediaDurationMin: 2,
    mediaDurationMax: 30,
    audioOnly: true,
  });
  assert.deepEqual(compatibility.seedream50Pro.resolutions, ['1.5k', '2k', '4k']);
  assert.equal(compatibility.installUpdateCommand, 'curl -fsSL https://jimeng.jianying.com/cli | bash');
  assert.match(config, /jimengCliCompatibility\.json/);
  assert.match(config, /dreamina login --headless/);
  assert.match(config, /dreamina login checklogin --device_code=<设备码> --poll=30/);
  assert.match(config, /dreamina user_credit/);
  assert.match(config, /dreamina relogin/);
  assert.match(config, /dreamina logout/);
  assert.match(help, /当前图像、视频和 SD2\.0 节点按/);
  assert.match(help, /JIMENG_CLI_OFFICIAL_GUIDE_URL/);
});

test('all Jimeng-capable generation nodes expose the shared top-right help button', () => {
  for (const file of ['ImageNode.tsx', 'VideoNode.tsx', 'SeedanceNode.tsx']) {
    const source = read(`../src/components/nodes/${file}`);
    assert.match(source, /import JimengCliHelpButton from '\.\/JimengCliHelpButton'/);
    assert.match(source, /<JimengCliHelpButton \/>/);
  }
});
