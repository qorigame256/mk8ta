// ホーム画面用アイコン（赤地に白いストップウォッチ）を app/icons/ に PNG で書き出す。
// 使い方: node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(OUT, { recursive: true });

// 0〜1 の座標で「白く塗るか」を返す
function white(x, y) {
  const cx = 0.5, cy = 0.56, r = 0.29;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= r && d >= r - 0.055) return true; // 外周の輪
  // 上のつまみ
  if (Math.abs(x - cx) <= 0.06 && y >= 0.17 && y <= 0.23) return true;
  if (Math.abs(x - cx) <= 0.025 && y >= 0.22 && y <= 0.28) return true;
  // 針（中心から右上へ）
  const ang = (-50 * Math.PI) / 180;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const px = x - cx, py = y - cy;
  const along = px * ux + py * uy;
  const across = Math.abs(-px * uy + py * ux);
  if (along >= -0.02 && along <= r - 0.09 && across <= 0.022) return true;
  if (d <= 0.04) return true; // 中心の点
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
      raw[o] = Math.round(0xe8 + (255 - 0xe8) * t);
      raw[o + 1] = Math.round(0x47 + (255 - 0x47) * t);
      raw[o + 2] = Math.round(0x3c + (255 - 0x3c) * t);
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
