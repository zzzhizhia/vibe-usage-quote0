import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const testDirectory = resolve('test');
const testFiles = readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => resolve(testDirectory, entry.name))
  .sort();

if (testFiles.length === 0) {
  console.error('没有找到测试文件');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
