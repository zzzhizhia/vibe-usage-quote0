import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { inspectPng } from '../src/png.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
}

function grayscalePng(rows) {
  const width = rows[0].length;
  const height = rows.length;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const raw = Buffer.concat(rows.map((row) => Buffer.from([0, ...row])));
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('PNG 检查量化黑白、墨点覆盖、边缘墨点与边界', () => {
  const png = grayscalePng([
    [0, 255, 255, 255],
    [255, 255, 0, 255],
    [255, 255, 255, 255],
  ]);
  const result = inspectPng(png);
  assert.deepEqual(result, {
    width: 4,
    height: 3,
    coloredPixels: 0,
    blackAndWhite: true,
    inkPixels: 2,
    inkCoverage: 0.16667,
    edgeInkPixels: 1,
    inkBounds: { left: 0, top: 0, right: 2, bottom: 1 },
  });
});
