import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('渲染图不是有效 PNG');
  }
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || idat.length === 0) throw new Error('PNG 缺少 IHDR 或 IDAT');
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`暂不支持的 PNG 格式：bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG 扫描行尺寸异常');
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  let coloredPixels = 0;
  let inkPixels = 0;
  let edgeInkPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[sourceOffset + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + Math.floor((left + up) / 2);
      else if (filter === 4) value = rawByte + paeth(left, up, upLeft);
      else throw new Error(`PNG 使用未知过滤器：${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
    sourceOffset += stride;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const red = pixels[offset];
      const green = colorType === 0 || colorType === 4 ? red : pixels[offset + 1];
      const blue = colorType === 0 || colorType === 4 ? red : pixels[offset + 2];
      const alpha = colorType === 4 ? pixels[offset + 1] : colorType === 6 ? pixels[offset + 3] : 255;
      if ((colorType === 2 || colorType === 6) && (red !== green || green !== blue)) coloredPixels += 1;
      const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
      if (alpha > 0 && luminance < 250) {
        inkPixels += 1;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeInkPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    width,
    height,
    coloredPixels,
    blackAndWhite: coloredPixels === 0,
    inkPixels,
    inkCoverage: Math.round((inkPixels / (width * height)) * 100_000) / 100_000,
    edgeInkPixels,
    inkBounds: inkPixels > 0 ? { left: minX, top: minY, right: maxX, bottom: maxY } : null,
  };
}
