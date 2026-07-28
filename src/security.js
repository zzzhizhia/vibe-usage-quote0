import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ALLOWED_FILES = new Set([
  'package.json',
  '.gitignore',
  'README.md',
  'PROGRESS.md',
  'BLOCKED.md',
]);
const ALLOWED_DIRECTORIES = new Set(['src', 'test', 'scripts', 'launchd', 'artifacts']);
const IGNORED_DIRECTORIES = new Set(['.git']);

function projectFiles(path, root = path) {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return [];
  if (!stat.isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name) && path === root) return [];
    return projectFiles(join(path, entry.name), root);
  });
}

export function isAllowedProjectPath(relativePath) {
  if (ALLOWED_FILES.has(relativePath)) return true;
  const [first] = relativePath.split(sep);
  return ALLOWED_DIRECTORIES.has(first);
}

export function scanProject(projectRoot, secretValues = []) {
  const secrets = [...new Set(secretValues.filter((value) => typeof value === 'string' && value.length >= 8))];
  let scanned = 0;
  let secretMatches = 0;
  const unexpectedPaths = [];

  for (const file of projectFiles(projectRoot)) {
    const relativePath = relative(projectRoot, file);
    if (!isAllowedProjectPath(relativePath)) unexpectedPaths.push(relativePath);
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    if (content.includes(0)) continue;
    scanned += 1;
    const text = content.toString('utf8');
    for (const secret of secrets) {
      if (text.includes(secret)) secretMatches += 1;
    }
  }

  return { scanned, secretMatches, unexpectedPaths: unexpectedPaths.sort() };
}
