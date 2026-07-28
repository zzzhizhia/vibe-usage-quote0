import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../src/security.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readConfig(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

const vibe = readConfig(join(homedir(), '.vibe-usage', 'config.json'));
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const quote = readConfig(join(configHome, 'vibe-usage-quote0', 'config.json'));
const secrets = [
  process.env.VIBE_USAGE_API_KEY,
  vibe.apiKey,
  process.env.QUOTE0_API_KEY,
  quote.apiKey,
];
const result = scanProject(projectRoot, secrets);

console.log(`credential_files_scanned=${result.scanned}`);
console.log(`unexpected_path_count=${result.unexpectedPaths.length}`);
console.log(`actual_secret_matches=${result.secretMatches}`);
if (result.secretMatches > 0 || result.unexpectedPaths.length > 0) process.exitCode = 1;
