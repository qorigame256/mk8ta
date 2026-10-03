// ホーム画面用アイコン（紫地に白い「TA」の文字）を app/icons/ に PNG で書き出す。
// 使い方: node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(OUT, { recursive: true });

// 0〜1 の座標で「白く塗るか」を返す（太い T と A）
function white(x, y) {
  const top = 0.31, bottom = 0.69;
  if (y < top || y > bottom) return false;
  // T：横棒と縦棒
  if (x >= 0.13 && x <= 0.47 && y <= top + 0.085) return true;
  if (Math.abs(x - 0.30) <= 0.045) return true;
  // A：頂点 (0.70, top) から左右の足へ伸びる2本の太線＋横棒
  const ax = 0.70, h = bottom - top, half = 0.165;
  for (const dir of [-1, 1]) {
    const dx = dir * half, len = Math.hypot(dx, h);
    const dist = Math.abs((x - ax) * h - (y - top) * dx) / len;
    if (dist <= 0.045) return true;
  }
  if (y >= 0.555 && y <= 0.625 && Math.abs(x - ax) <= half * ((y - top) / h)) return true;
  return false;
}

function png(size) {
  const SS = 4; // 縁をなめらかにするため 4x4 で数える
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let w = 0;
      for (let a = 0; a < SS; a++)
        for (let b = 0; b < SS; b++) if (white((i + (a + 0.5) / SS) / size, (j + (b + 0.5) / SS) / size)) w++;
      const t = w / (SS * SS);
      const o = j * (size * 3 + 1) + 1 + i * 3;
      raw[o] = Math.round(0x7b + (255 - 0x7b) * t);
      raw[o + 1] = Math.round(0x3f + (255 - 0x3f) * t);
      raw[o + 2] = Math.round(0xe4 + (255 - 0xe4) * t);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${s}.png`), png(s));
  console.log(`icon-${s}.png`);
}
