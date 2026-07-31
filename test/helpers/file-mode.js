import * as nodeFs from 'node:fs';

export function createChmodTracker() {
  const calls = [];
  const chmodSyncImpl = (path, mode) => {
    calls.push({ path, mode });
    nodeFs.chmodSync(path, mode);
  };
  return {
    calls,
    chmodSyncImpl,
    fileSystem: { ...nodeFs, chmodSync: chmodSyncImpl },
  };
}

export function hasPrivateChmod(calls, destinationPath) {
  return calls.some(({ path, mode }) => (
    mode === 0o600
    && (
      path === destinationPath
      || (path.startsWith(`${destinationPath}.`) && path.endsWith('.tmp'))
    )
  ));
}
