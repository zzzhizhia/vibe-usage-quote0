import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = 'vibe-usage-quote0';

function commandFailureDetail(result) {
  return String(result.stderr || result.stdout || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function updateSelf(options = {}) {
  const platform = options.platform ?? process.platform;
  const npmCommand = options.npmCommand ?? (platform === 'win32' ? 'npm.cmd' : 'npm');
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const npmArgs = [
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    `${PACKAGE_NAME}@latest`,
  ];
  const command = platform === 'win32'
    ? (options.env?.ComSpec ?? process.env.ComSpec ?? 'cmd.exe')
    : npmCommand;
  const args = platform === 'win32'
    ? ['/d', '/s', '/c', npmCommand, ...npmArgs]
    : npmArgs;
  const result = spawn(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env ?? process.env,
  });
  if (result.error) throw new Error(`无法启动 npm：${result.error.message}`);
  if (result.status !== 0) {
    const detail = commandFailureDetail(result);
    throw new Error(`npm 全局更新失败${detail ? `：${detail}` : ''}`);
  }
  return { packageName: PACKAGE_NAME, packageSpec: `${PACKAGE_NAME}@latest`, command: npmCommand };
}
