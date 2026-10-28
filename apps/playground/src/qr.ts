// Minimal, dependency-free QR Code encoder: byte mode, error correction L or M, versions 1-40.
// Follows the structure of Project Nayuki's QR Code generator (MIT licence).

type Ecl = 'L' | 'M';

export interface QrCode {
  readonly version: number;
  readonly size: number;
  readonly ecl: Ecl;
  isDark(x: number, y: number): boolean;
}

/** Longest UTF-8 payload (in bytes) that fits in a version 40-L symbol. */
export const QR_MAX_BYTES = 2953;

// Index = version (index 0 unused).
const ECC_PER_BLOCK: Record<Ecl, readonly number[]> = {
  L: [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
};

const NUM_BLOCKS: Record<Ecl, readonly number[]> = {
  L: [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
    19, 20, 21, 22, 24, 25,
  ],
  M: [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
    33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
};

const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0 };

function at(a: ArrayLike<number>, i: number): number {
  return a[i] ?? 0;
}

function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    result -= (25 * n - 10) * n - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, ecl: Ecl): number {
  return Math.floor(rawModules(version) / 8) - at(ECC_PER_BLOCK[ecl], version) * at(NUM_BLOCKS[ecl], version);
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(at(r, j), root);
      if (j + 1 < degree) r[j] = at(r, j) ^ at(r, j + 1);
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (r.shift() ?? 0);
    r.push(0);
    for (let i = 0; i < divisor.length; i++) r[i] = at(r, i) ^ gfMul(at(divisor, i), factor);
  }
  return r;
}

function addEcc(data: readonly number[], version: number, ecl: Ecl): number[] {
  const numBlocks = at(NUM_BLOCKS[ecl], version);
  const eccLen = at(ECC_PER_BLOCK[ecl], version);
  const rawCodewords = Math.floor(rawModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  const blockLen = blocks[0]?.length ?? 0;
  for (let i = 0; i < blockLen; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(at(block, i));
    });
  }
  return out;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < n; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function buildMatrix(version: number, ecl: Ecl, codewords: readonly number[]): QrCode {
  const size = version * 4 + 17;
  const mods = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const get = (x: number, y: number): boolean => mods[y * size + x] === 1;
  const set = (x: number, y: number, dark: boolean): void => {
    mods[y * size + x] = dark ? 1 : 0;
  };
  const setFn = (x: number, y: number, dark: boolean): void => {
    set(x, y, dark);
    fn[y * size + x] = 1;
  };
  const isFn = (x: number, y: number): boolean => fn[y * size + x] === 1;

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder patterns with separators.
  const finders: [number, number][] = [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ];
  for (const [cx, cy] of finders) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Alignment patterns.
  const pos = alignmentPositions(version, size);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      const cx = at(pos, i);
      const cy = at(pos, j);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormat = (mask: number): void => {
    const data = (FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i: number): boolean => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, b(i));
    setFn(8, 7, b(6));
    setFn(8, 8, b(7));
    setFn(7, 8, b(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, b(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);

  // Version information.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, dark);
      setFn(b, a, dark);
    }
  }

  // Data, in the zigzag order.
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn(x, y) && bit < total) {
          set(x, y, ((at(codewords, bit >>> 3) >>> (7 - (bit & 7))) & 1) === 1);
          bit++;
        }
      }
    }
  }

  const applyMask = (mask: number): void => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFn(x, y) && maskBit(mask, x, y)) set(x, y, !get(x, y));
      }
    }
  };

  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [...P1].reverse();
  const penalty = (): number => {
    let p = 0;
    for (let o = 0; o < 2; o++) {
      for (let i = 0; i < size; i++) {
        const line: number[] = [];
        for (let j = 0; j < size; j++) line.push((o === 0 ? get(j, i) : get(i, j)) ? 1 : 0);
        let run = 0;
        let prev = -1;
        for (const c of line) {
          if (c === prev) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else {
            prev = c;
            run = 1;
          }
        }
        for (let j = 0; j + 11 <= size; j++) {
          let m1 = true;
          let m2 = true;
          for (let k = 0; k < 11; k++) {
            const c = line[j + k];
            if (c !== P1[k]) m1 = false;
            if (c !== P2[k]) m2 = false;
          }
          if (m1) p += 40;
          if (m2) p += 40;
        }
      }
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = get(x, y);
        if (c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) p += 3;
      }
    }
    let dark = 0;
    for (const v of mods) dark += v;
    const cells = size * size;
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - cells * 10) / cells) - 1) * 10;
    return p;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    drawFormat(m);
    applyMask(m);
    const s = penalty();
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    applyMask(m);
  }
  drawFormat(best);
  applyMask(best);

  return { version, size, ecl, isDark: get };
}

/** Encodes text (UTF-8, byte mode) at the smallest version, preferring level M when it fits at that size. */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  let ccBits = 8;
  for (let v = 1; v <= 40; v++) {
    const cc = v < 10 ? 8 : 16;
    if (4 + cc + bytes.length * 8 <= dataCodewords(v, 'L') * 8) {
      version = v;
      ccBits = cc;
      break;
    }
  }
  if (version === 0) throw new RangeError('Text is too long for a QR code');
  const used = 4 + ccBits + bytes.length * 8;
  const ecl: Ecl = used <= dataCodewords(version, 'M') * 8 ? 'M' : 'L';
  const capacity = dataCodewords(version, ecl) * 8;

  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ccBits);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0);
    data.push(b);
  }
  return buildMatrix(version, ecl, addEcc(data, version, ecl));
}

/** Paints the code onto a canvas, black on white, with a quiet zone of `margin` modules. */
export function drawQr(canvas: HTMLCanvasElement, qr: QrCode, scale: number, margin = 4): void {
  const dim = (qr.size + margin * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, dim, dim);
  g.fillStyle = '#000000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.isDark(x, y)) g.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    }
  }
}
