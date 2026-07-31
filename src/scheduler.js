import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeIntervalMinutes } from './config.js';

const LAUNCHD_LABEL = 'com.vibeusage.vibe-usage-quote0';
const SYSTEMD_NAME = 'vibe-usage-quote0';
const CLI_PATH = fileURLToPath(new URL('./index.js', import.meta.url));
const LAUNCHD_TEMPLATE = fileURLToPath(
  new URL('../launchd/com.vibeusage.vibe-usage-quote0.plist', import.meta.url),
);
const WINDOWS_INSTALL_SCRIPT = fileURLToPath(new URL('../windows/install.ps1', import.meta.url));
const WINDOWS_UPDATE_SCRIPT = fileURLToPath(new URL('../windows/update-interval.ps1', import.meta.url));
const WINDOWS_UNINSTALL_SCRIPT = fileURLToPath(new URL('../windows/uninstall.ps1', import.meta.url));

export function windowsPowerShellEnvironment(env = process.env) {
  const childEnv = { ...env };
  for (const name of Object.keys(childEnv)) {
    if (name.toLowerCase() === 'psmodulepath') delete childEnv[name];
  }
  return childEnv;
}

function runProcess(command, args, options, failureMessage) {
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env ?? process.env,
  });
  if (result.error) throw new Error(`${failureMessage}：${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    throw new Error(`${failureMessage}${detail ? `：${detail}` : ''}`);
  }
  return result;
}

function writeFileAtomically(path, content, options = {}) {
  const fileSystem = options.fileSystem ?? nodeFs;
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fileSystem.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const descriptor = fileSystem.openSync(tempPath, 'wx', 0o600);
    try {
      fileSystem.writeFileSync(descriptor, content, 'utf8');
      fileSystem.fsyncSync(descriptor);
    } finally {
      fileSystem.closeSync(descriptor);
    }
    fileSystem.chmodSync(tempPath, 0o600);
    if (options.validate) options.validate(tempPath);
    fileSystem.renameSync(tempPath, path);
  } catch (error) {
    try {
      if (fileSystem.existsSync(tempPath)) fileSystem.unlinkSync(tempPath);
    } catch {
      // Keep the original error; a restricted temporary file is safer than hiding the cause.
    }
    throw error;
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function scheduledEnvironment(env) {
  return ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']
    .filter((name) => env[name])
    .map((name) => [name, String(env[name])]);
}

function launchdEnvironmentXml(env) {
  const entries = scheduledEnvironment(env);
  if (entries.length === 0) return '';
  const values = entries
    .map(([name, value]) => `    <key>${name}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n');
  return `  <key>EnvironmentVariables</key>\n  <dict>\n${values}\n  </dict>\n`;
}

export function launchAgentPath(options = {}) {
  return options.plistPath
    ?? join(options.home ?? homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function launchdStateDirectory(options = {}) {
  const env = options.env ?? process.env;
  const root = env.XDG_STATE_HOME ?? join(options.home ?? homedir(), '.local', 'state');
  return join(root, SYSTEMD_NAME);
}

function renderLaunchAgent(intervalMinutes, options = {}) {
  const fileSystem = options.fileSystem ?? nodeFs;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const stateDirectory = launchdStateDirectory(options);
  const replacements = new Map([
    ['__NODE_PATH__', options.nodePath ?? process.execPath],
    ['__CLI_PATH__', options.cliPath ?? CLI_PATH],
    ['__WORKING_DIRECTORY__', home],
    ['__STDOUT_PATH__', join(stateDirectory, 'launchd.stdout.log')],
    ['__STDERR_PATH__', join(stateDirectory, 'launchd.stderr.log')],
  ]);
  let plist = fileSystem.readFileSync(options.templatePath ?? LAUNCHD_TEMPLATE, 'utf8');
  for (const [placeholder, value] of replacements) {
    plist = plist.replace(placeholder, xmlEscape(value));
  }
  plist = plist.replace('<integer>1800</integer>', `<integer>${intervalMinutes * 60}</integer>`);
  plist = plist.replace(
    /<\/dict>\r?\n<\/plist>/,
    `${launchdEnvironmentXml(env)}</dict>\n</plist>`,
  );
  if (/__[A-Z_]+__/.test(plist)) throw new Error('launchd 模板包含未替换占位符');
  return { plist, stateDirectory };
}

export function installMacosLaunchAgent(options = {}) {
  const intervalMinutes = normalizeIntervalMinutes(options.intervalMinutes);
  const uid = options.uid ?? process.getuid?.();
  if (!Number.isInteger(uid)) throw new Error('无法确定当前用户，不能安装 launchd 任务');
  const plistPath = launchAgentPath(options);
  const { plist, stateDirectory } = renderLaunchAgent(intervalMinutes, options);
  const fileSystem = options.fileSystem ?? nodeFs;
  fileSystem.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileAtomically(plistPath, plist, {
    ...options,
    validate(path) {
      runProcess('plutil', ['-lint', path], options, '生成的 launchd plist 校验失败');
    },
  });

  const domain = `gui/${uid}`;
  const service = `${domain}/${LAUNCHD_LABEL}`;
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const current = spawn('launchctl', ['print', service], {
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  if (current.error) throw new Error(`无法检查现有 launchd 任务：${current.error.message}`);
  if (current.status === 0) {
    runProcess('launchctl', ['bootout', service], options, '无法卸载现有 launchd 任务');
  }
  runProcess('launchctl', ['bootstrap', domain, plistPath], options, '无法加载 launchd 任务');
  return { platform: 'darwin', installed: true, plistPath, intervalMinutes };
}

function systemdQuote(value) {
  const normalized = String(value);
  if (/[\0\r\n]/.test(normalized)) throw new Error('systemd 路径或环境变量包含不支持的控制字符');
  return `"${normalized
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')}"`;
}

export function linuxSystemdPaths(options = {}) {
  const env = options.env ?? process.env;
  const root = env.XDG_CONFIG_HOME ?? join(options.home ?? homedir(), '.config');
  const directory = options.systemdDirectory ?? join(root, 'systemd', 'user');
  return {
    directory,
    servicePath: options.servicePath ?? join(directory, `${SYSTEMD_NAME}.service`),
    timerPath: options.timerPath ?? join(directory, `${SYSTEMD_NAME}.timer`),
  };
}

function renderSystemdService(options = {}) {
  const env = options.env ?? process.env;
  const environment = scheduledEnvironment(env)
    .map(([name, value]) => `Environment=${systemdQuote(`${name}=${value}`)}`)
    .join('\n');
  return `[Unit]
Description=Push Vibe Usage to Quote/0

[Service]
Type=oneshot
${environment ? `${environment}\n` : ''}WorkingDirectory=${systemdQuote(options.home ?? homedir())}
ExecStart=${systemdQuote(options.nodePath ?? process.execPath)} ${systemdQuote(options.cliPath ?? CLI_PATH)} push
`;
}

function renderSystemdTimer(intervalMinutes) {
  return `[Unit]
Description=Refresh Vibe Usage on Quote/0

[Timer]
OnStartupSec=1min
OnUnitActiveSec=${intervalMinutes}min
AccuracySec=1min
Unit=${SYSTEMD_NAME}.service

[Install]
WantedBy=timers.target
`;
}

export function installLinuxSystemdTimer(options = {}) {
  const intervalMinutes = normalizeIntervalMinutes(options.intervalMinutes);
  const paths = linuxSystemdPaths(options);
  writeFileAtomically(paths.servicePath, renderSystemdService(options), options);
  writeFileAtomically(paths.timerPath, renderSystemdTimer(intervalMinutes), options);
  runProcess('systemctl', ['--user', 'daemon-reload'], options, '无法重载 systemd 用户配置');
  runProcess(
    'systemctl',
    ['--user', 'enable', '--now', `${SYSTEMD_NAME}.timer`],
    options,
    '无法启用 systemd 用户定时任务',
  );
  return { platform: 'linux', installed: true, ...paths, intervalMinutes };
}

export function installScheduledTask(options = {}) {
  const platform = options.platform ?? process.platform;
  const intervalMinutes = normalizeIntervalMinutes(options.intervalMinutes);
  if (platform === 'darwin') return installMacosLaunchAgent({ ...options, intervalMinutes });
  if (platform === 'linux') return installLinuxSystemdTimer({ ...options, intervalMinutes });
  if (platform !== 'win32') throw new Error(`当前平台不支持自动刷新：${platform}`);

  const result = runProcess('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    options.windowsScriptPath ?? WINDOWS_INSTALL_SCRIPT,
    '-IntervalMinutes',
    String(intervalMinutes),
  ], {
    ...options,
    env: windowsPowerShellEnvironment(options.env),
  }, 'Windows 计划任务安装失败');
  return { platform, installed: true, intervalMinutes, output: String(result.stdout) };
}

function updateLinuxSystemdTimer(intervalMinutes, options = {}) {
  const paths = linuxSystemdPaths(options);
  const fileSystem = options.fileSystem ?? nodeFs;
  if (!fileSystem.existsSync(paths.timerPath)) {
    return { platform: 'linux', installed: false, updated: false, ...paths };
  }
  writeFileAtomically(paths.timerPath, renderSystemdTimer(intervalMinutes), options);
  runProcess('systemctl', ['--user', 'daemon-reload'], options, '无法重载 systemd 用户配置');
  runProcess(
    'systemctl',
    ['--user', 'restart', `${SYSTEMD_NAME}.timer`],
    options,
    '无法重启 systemd 用户定时任务',
  );
  return { platform: 'linux', installed: true, updated: true, ...paths };
}

export function updateInstalledSchedule(intervalMinutes, options = {}) {
  const minutes = normalizeIntervalMinutes(intervalMinutes);
  const platform = options.platform ?? process.platform;

  if (platform === 'win32') {
    const result = runProcess('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.windowsScriptPath ?? WINDOWS_UPDATE_SCRIPT,
      '-IntervalMinutes',
      String(minutes),
    ], {
      ...options,
      env: windowsPowerShellEnvironment(options.env),
    }, '无法更新 Windows 计划任务刷新间隔');
    const updated = /schedule_updated=true/i.test(String(result.stdout));
    return { platform, installed: updated, updated };
  }

  if (platform === 'darwin') {
    const plistPath = launchAgentPath(options);
    const fileSystem = options.fileSystem ?? nodeFs;
    const fileExists = options.existsSyncImpl ?? ((path) => fileSystem.existsSync(path));
    if (!fileExists(plistPath)) return { platform, installed: false, updated: false, plistPath };
    runProcess('plutil', [
      '-replace',
      'StartInterval',
      '-integer',
      String(minutes * 60),
      plistPath,
    ], options, '无法更新 launchd plist 刷新间隔');

    const uid = options.uid ?? process.getuid?.();
    if (!Number.isInteger(uid)) return { platform, installed: true, updated: true, loaded: false, plistPath };
    const domain = `gui/${uid}`;
    const spawn = options.spawnSyncImpl ?? spawnSync;
    const current = spawn('launchctl', ['print', `${domain}/${LAUNCHD_LABEL}`], {
      encoding: 'utf8',
      env: options.env ?? process.env,
    });
    if (current.error || current.status !== 0) {
      return { platform, installed: true, updated: true, loaded: false, plistPath };
    }
    runProcess('launchctl', ['bootout', `${domain}/${LAUNCHD_LABEL}`], options, '无法卸载旧的 launchd 任务');
    runProcess('launchctl', ['bootstrap', domain, plistPath], options, 'plist 已更新，但无法重新加载 launchd 任务');
    return { platform, installed: true, updated: true, loaded: true, plistPath };
  }

  if (platform === 'linux') return updateLinuxSystemdTimer(minutes, options);
  return { platform, installed: false, updated: false, unsupported: true };
}

function disableLinuxSystemdTimer(options = {}) {
  const paths = linuxSystemdPaths(options);
  const fileSystem = options.fileSystem ?? nodeFs;
  const installed = fileSystem.existsSync(paths.servicePath) || fileSystem.existsSync(paths.timerPath);
  if (!installed) return { platform: 'linux', disabled: false, absent: true, ...paths };
  runProcess(
    'systemctl',
    ['--user', 'disable', '--now', `${SYSTEMD_NAME}.timer`],
    options,
    '无法停用 systemd 用户定时任务',
  );
  if (fileSystem.existsSync(paths.timerPath)) fileSystem.unlinkSync(paths.timerPath);
  if (fileSystem.existsSync(paths.servicePath)) fileSystem.unlinkSync(paths.servicePath);
  runProcess('systemctl', ['--user', 'daemon-reload'], options, '任务已删除，但无法重载 systemd 用户配置');
  return { platform: 'linux', disabled: true, absent: false, ...paths };
}

export function disableSchedule(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const result = runProcess('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.windowsScriptPath ?? WINDOWS_UNINSTALL_SCRIPT,
    ], {
      ...options,
      env: windowsPowerShellEnvironment(options.env),
    }, '无法解除 Windows 计划任务');
    const output = String(result.stdout);
    return {
      platform,
      disabled: /uninstalled_task=/i.test(output),
      absent: /task_absent=/i.test(output),
    };
  }

  if (platform === 'darwin') {
    const uid = options.uid ?? process.getuid?.();
    if (!Number.isInteger(uid)) throw new Error('无法确定当前用户，不能安全解除 launchd 任务');
    const service = `gui/${uid}/${LAUNCHD_LABEL}`;
    const spawn = options.spawnSyncImpl ?? spawnSync;
    const current = spawn('launchctl', ['print', service], {
      encoding: 'utf8',
      env: options.env ?? process.env,
    });
    if (current.error) throw new Error(`无法检查 launchd 任务：${current.error.message}`);
    const loaded = current.status === 0;
    if (loaded) runProcess('launchctl', ['bootout', service], options, '无法解除 launchd 任务');

    const plistPath = launchAgentPath(options);
    const fileSystem = options.fileSystem ?? nodeFs;
    const fileExists = options.existsSyncImpl ?? ((path) => fileSystem.existsSync(path));
    const removeFile = options.unlinkSyncImpl ?? ((path) => fileSystem.unlinkSync(path));
    const installed = fileExists(plistPath);
    if (installed) removeFile(plistPath);
    return {
      platform,
      disabled: loaded || installed,
      loaded,
      removed: installed,
      absent: !loaded && !installed,
      plistPath,
    };
  }

  if (platform === 'linux') return disableLinuxSystemdTimer(options);
  return { platform, disabled: false, absent: true, unsupported: true };
}
