// Decodificador GIF mínimo (primer fotograma, sin entrelazado) para comparar capturas.
// Formato: GIF89a (W3C/CompuServe), LZW de código variable.

export interface Image { width: number; height: number; rgb: Uint8Array } // RGB por píxel

export function decodeGif(b: Uint8Array): Image {
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("no es GIF");
  const width = b[6]! | (b[7]! << 8), height = b[8]! | (b[9]! << 8);
  let p = 13;
  let gct: Uint8Array | null = null;
  if (b[10]! & 0x80) {
    const n = 3 * (2 << (b[10]! & 7));
    gct = b.subarray(p, p + n);
    p += n;
  }
  for (;;) {
    const id = b[p++]!;
    if (id === 0x21) {               // extensión: saltar sub-bloques
      p++;
      while (b[p]!) p += b[p]! + 1;
      p++;
    } else if (id === 0x2c) {        // descriptor de imagen
      const x0 = b[p]! | (b[p + 1]! << 8), y0 = b[p + 2]! | (b[p + 3]! << 8);
      const w = b[p + 4]! | (b[p + 5]! << 8), h = b[p + 6]! | (b[p + 7]! << 8);
      const flags = b[p + 8]!;
      p += 9;
      let ct = gct;
      if (flags & 0x80) {
        const n = 3 * (2 << (flags & 7));
        ct = b.subarray(p, p + n);
        p += n;
      }
      if (flags & 0x40) throw new Error("GIF entrelazado no soportado");
      if (!ct) throw new Error("GIF sin paleta");
      const minSize = b[p++]!;
      const data: number[] = [];
      while (b[p]!) { data.push(...b.subarray(p + 1, p + 1 + b[p]!)); p += b[p]! + 1; }
      const idx = lzw(data, minSize, w * h);
      const rgb = new Uint8Array(width * height * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = idx[y * w + x]!, o = ((y0 + y) * width + x0 + x) * 3;
          rgb[o] = ct[c * 3]!; rgb[o + 1] = ct[c * 3 + 1]!; rgb[o + 2] = ct[c * 3 + 2]!;
        }
      return { width, height, rgb };
    } else throw new Error(`bloque GIF desconocido ${id}`);
  }
}

function lzw(data: number[], minSize: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; }
  let o = 0, prev = -1, bits = 0, acc = 0, pos = 0;
  const stack = new Uint8Array(4096);
  while (o < n) {
    while (bits < size && pos < data.length) { acc |= data[pos++]! << bits; bits += 8; }
    if (bits < size) break;
    const code = acc & ((1 << size) - 1);
    acc >>>= size; bits -= size;
    if (code === clear) { size = minSize + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let c = code, sp = 0;
    if (code >= next) { stack[sp++] = first[prev]!; c = prev; }
    while (c >= 0) { stack[sp++] = suffix[c]!; c = prefix[c]!; }
    while (sp && o < n) out[o++] = stack[--sp]!;
    if (prev >= 0 && next < 4096) {
      // Nueva entrada = cadena(prev) + primer carácter de cadena(code); si code es la
      // entrada que se está creando (caso KwKwK) ese carácter es el primero de prev.
      prefix[next] = prev;
      suffix[next] = code < next ? first[code]! : first[prev]!;
      first[next] = first[prev]!;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}
