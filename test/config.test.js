import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { dataDirectory } from '../src/config.js';

test('渲染图目录遵循 XDG_DATA_HOME', () => {
  assert.equal(
    dataDirectory({ XDG_DATA_HOME: '/tmp/vibe-data' }),
    join('/tmp/vibe-data', 'vibe-usage-quote0'),
  );
});
