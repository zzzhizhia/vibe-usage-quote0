import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HttpError } from '../http.js';

const EMPTY_USAGE = {
  buckets: [],
  sessions: [],
  hasAnyData: false,
};

function fixtureIo(output) {
  const secrets = [
    'fixture-vibe-placeholder-1001',
    'fixture-quote-placeholder-2002',
    'fixture-device-placeholder-3003',
  ];
  return {
    isTTY: true,
    write(line) {
      output(`${line}\n`);
      if (String(line).includes('配置完成')) output('enable_fixture_completed=true\n');
    },
    async secret() { return secrets.shift(); },
    async confirm() { return true; },
    async select(message, choices, defaultIndex) { return choices[defaultIndex].value; },
  };
}

export function createSetupFixtureOptions(env, baseOptions = {}) {
  const scenario = env.VIBE_USAGE_QUOTE0_SETUP_FIXTURE;
  const root = env.VIBE_USAGE_QUOTE0_SETUP_FIXTURE_ROOT;
  if (!['success', '401'].includes(scenario)) throw new Error('未知 enable fixture 场景');
  if (!root || !basename(root).startsWith('vibe-usage-quote0-setup-fixture-')) {
    throw new Error('enable fixture 必须使用专用临时目录');
  }
  const paths = {
    vibe: join(root, 'home', '.vibe-usage', 'config.json'),
    quote: join(root, 'appdata', 'vibe-usage-quote0', 'config.json'),
  };
  if (existsSync(paths.vibe) || existsSync(paths.quote)) {
    throw new Error('enable fixture 拒绝覆盖已有配置');
  }
  const output = baseOptions.fixtureStdout ?? ((text) => process.stdout.write(text));
  return {
    ...baseOptions,
    platform: 'win32',
    paths,
    io: fixtureIo(output),
    apiClient: {
      async fetchUsage() {
        if (scenario === '401') throw new HttpError('Vibe 用量返回 HTTP 401', 401);
        return EMPTY_USAGE;
      },
      async listDeviceTasks() {
        return { data: { tasks: [{ taskKey: 'fixture-canvas-placeholder-4004', type: 'CANVAS_API' }] } };
      },
      async getCanvasStatus() {
        return { data: { status: { current: 'Power Active' }, renderInfo: {} } };
      },
      async pushCanvas() {
        return { changed: true, postStatus: 200 };
      },
    },
    protectFile: process.platform === 'win32' ? undefined : () => {},
    installScheduledTask() {},
    now: new Date('2026-07-30T00:00:00Z'),
  };
}
