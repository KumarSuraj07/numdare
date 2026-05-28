// make-icons.js — pure Node.js, no external deps
const fs = require('fs');
const zlib = require('zlib');

// ── Minimal PNG decoder ──────────────────────────────────────────────────────
function readUint32(buf, off) { return (buf[off]<<24|buf[off+1]<<16|buf[off+2]<<8|buf[off+3])>>>0; }

function decodePNG(buf) {
  let pos = 8; // skip signature
  let width, height, bitDepth, colorType, idat = [];
  while (pos < buf.length) {
    const len = readUint32(buf, pos); pos += 4;
    const type = buf.slice(pos, pos+4).toString('ascii'); pos += 4;
    const data = buf.slice(pos, pos+len); pos += len + 4; // skip CRC
    if (type === 'IHDR') { width=readUint32(data,0); height=readUint32(data,4); bitDepth=data[8]; colorType=data[9]; }
    if (type === 'IDAT') idat.push(data);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // colorType 6 = RGBA, 2 = RGB, 0 = grayscale, 3 = indexed
  const bpp = (colorType===6)?4:(colorType===2)?3:4;
  const stride = width * bpp;
  // Reconstruct pixels (PNG filter)
  const pixels = Buffer.alloc(height * stride);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const row = raw.slice(rawPos, rawPos + stride); rawPos += stride;
    const prev = y > 0 ? pixels.slice((y-1)*stride, y*stride) : Buffer.alloc(stride);
    const out = pixels.slice(y*stride, (y+1)*stride);
    for (let x = 0; x < stride; x++) {
      const a = row[x];
      const b = prev[x] || 0;
      const c_val = x >= bpp ? (prev[x-bpp]||0) : 0;
      const d = x >= bpp ? out[x-bpp] : 0;
      if (filter===0) out[x]=a;
      else if (filter===1) out[x]=(a+d)&0xff;
      else if (filter===2) out[x]=(a+b)&0xff;
      else if (filter===3) out[x]=(a+Math.floor((d+b)/2))&0xff;
      else if (filter===4) {
        const pa=Math.abs(b-c_val), pb=Math.abs(d-c_val), pc=Math.abs(d+b-2*c_val);
        out[x]=(a+(pa<=pb&&pa<=pc?d:pb<=pc?b:c_val))&0xff;
      }
    }
  }
  return { width, height, pixels, bpp };
}

// ── Minimal PNG encoder ──────────────────────────────────────────────────────
function encodePNG(width, height, rgba) {
  function u32(n) { const b=Buffer.alloc(4); b.writeUInt32BE(n,0); return b; }
  function chunk(type, data) {
    const t = Buffer.from(type,'ascii');
    const crc = crc32(Buffer.concat([t, data]));
    return Buffer.concat([u32(data.length), t, data, u32(crc)]);
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) { c ^= b; for (let i=0;i<8;i++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); }
    return (c^0xffffffff)>>>0;
  }
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const raw = Buffer.alloc(height*(1+width*4));
  for (let y=0;y<height;y++) {
    raw[y*(1+width*4)]=0; // filter none
    rgba.copy(raw, y*(1+width*4)+1, y*width*4, (y+1)*width*4);
  }
  const idat = zlib.deflateSync(raw, {level:6});
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
}

// ── Composite: purple bg + white puzzle ─────────────────────────────────────
function makeIcon(srcPath, size, outPath) {
  const src = decodePNG(fs.readFileSync(srcPath));
  const out = Buffer.alloc(size * size * 4);

  // Fill purple background: #6d28d9
  for (let i = 0; i < size * size; i++) {
    out[i*4]   = 109; // R
    out[i*4+1] = 40;  // G
    out[i*4+2] = 217; // B
    out[i*4+3] = 255; // A
  }

  // Draw puzzle scaled with 15% padding, recolored white
  const pad = Math.floor(size * 0.15);
  const inner = size - pad * 2;
  for (let dy = 0; dy < inner; dy++) {
    for (let dx = 0; dx < inner; dx++) {
      const sx = Math.floor(dx * src.width / inner);
      const sy = Math.floor(dy * src.height / inner);
      const srcIdx = (sy * src.width + sx) * src.bpp;
      const alpha = src.bpp === 4 ? src.pixels[srcIdx+3] : 255;
      if (alpha > 10) {
        const outIdx = ((dy + pad) * size + (dx + pad)) * 4;
        // Blend white over purple based on alpha
        const a = alpha / 255;
        out[outIdx]   = Math.round(255 * a + 109 * (1-a));
        out[outIdx+1] = Math.round(255 * a + 40  * (1-a));
        out[outIdx+2] = Math.round(255 * a + 217 * (1-a));
        out[outIdx+3] = 255;
      }
    }
  }

  fs.writeFileSync(outPath, encodePNG(size, size, out));
  console.log('Saved', outPath);
}

makeIcon('puzzle.png', 192, 'icon-192.png');
makeIcon('puzzle.png', 512, 'icon-512.png');
