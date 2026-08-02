import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedProjectPath, scanProject } from '../src/security.js';

test('安全扫描覆盖白名单外文件并同时识别真实秘密值', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-quote0-security-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'src', 'safe.js'), 'export const safe = true;');
  writeFileSync(join(root, 'q'), '{"apiKey":"quote-test-secret"}');
  const result = scanProject(root, ['quote-test-secret']);
  assert.equal(result.scanned, 3);
  assert.equal(result.secretMatches, 1);
  assert.deepEqual(result.unexpectedPaths, ['q']);
});

test('路径白名单只接受明确文件与允许目录', () => {
  assert.equal(isAllowedProjectPath('README.md'), true);
  assert.equal(isAllowedProjectPath('CHANGELOG.md'), true);
  assert.equal(isAllowedProjectPath('LICENSE'), true);
  assert.equal(isAllowedProjectPath('pnpm-lock.yaml'), true);
  assert.equal(isAllowedProjectPath(join('.github', 'workflows', 'publish.yml')), true);
  assert.equal(isAllowedProjectPath(join('artifacts', 'quote0-render.png')), true);
  assert.equal(isAllowedProjectPath(join('windows', 'install.ps1')), true);
  assert.equal(isAllowedProjectPath(join('.codex', 'config.toml')), true);
  assert.equal(isAllowedProjectPath(join('.codex', 'hooks.json')), true);
  assert.equal(isAllowedProjectPath(join('.entire', '.gitignore')), true);
  assert.equal(isAllowedProjectPath(join('.entire', 'settings.json')), true);
  assert.equal(isAllowedProjectPath(join('.codex', 'local.json')), false);
  assert.equal(isAllowedProjectPath(join('.entire', 'credentials.json')), false);
  assert.equal(isAllowedProjectPath('q'), false);
  assert.equal(isAllowedProjectPath(join('node_modules', 'package.json')), false);
});

test('安全扫描覆盖 Windows 脚本且识别其中秘密值', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-quote0-windows-security-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'windows'));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'windows', 'run.ps1'), 'scheduler-test-secret');

  const result = scanProject(root, ['scheduler-test-secret']);

  assert.equal(result.scanned, 2);
  assert.equal(result.secretMatches, 1);
  assert.deepEqual(result.unexpectedPaths, []);
});
