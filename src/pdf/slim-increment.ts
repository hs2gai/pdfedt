/**
 * Slimming of incremental saves.
 *
 * PDFium's FPDF_INCREMENTAL rewrites "every old object loaded into memory" into the increment,
 * so with large documents the file nearly doubles on every save. PDFium's serialization is deterministic,
 * so we compare the "increment right after opening (baseline)" with the "increment at save time" and, for objects
 * whose bytes are identical, keep the definition in the original file (leave them out of the increment) to limit the size.
 *
 * Only objects identical to the baseline are dropped. Anything that cannot be compared is always kept,
 * so the result is never broken (at worst it equals PDFium's increment).
 *
 * The xref is rewritten in the same format as PDFium (classic table / uncompressed xref stream).
 */

const enc = new TextEncoder();
const dec = new TextDecoder('latin1');

interface XrefEntry {
  objnum: number;
  type: 0 | 1;
  /** type 1: offset from the start of the file */
  offset: number;
  gen: number;
}

export interface ParsedIncrement {
  mode: 'table' | 'stream';
  /** Objects defined in this increment (objnum → bytes of "N 0 obj ... endobj") */
  objects: Map<number, Uint8Array>;
  /** Free entries (carried over as-is) */
  free: XrefEntry[];
  /** Body of the trailer dictionary (inside << >>, without /W /Index /Length /Filter /Type) */
  trailerBody: string;
  /** Object number of the xref stream (stream mode only) */
  xrefObjnum?: number;
}

/** Parse the increment written by PDFium (after original) */
export function parseIncrement(full: Uint8Array, originalLength: number): ParsedIncrement {
  const tail = full.subarray(originalLength);
  const text = dec.decode(tail);
  const sx = text.lastIndexOf('startxref');
  if (sx < 0) throw new Error('startxref not found in increment');
  const xrefOffset = parseInt(text.slice(sx + 9).trim(), 10);
  if (!Number.isFinite(xrefOffset) || xrefOffset < originalLength)
    throw new Error('xref offset is not inside the increment');
  const xrefText = text.slice(xrefOffset - originalLength, sx);

  const entries: XrefEntry[] = [];
  let trailerBody: string;
  let mode: ParsedIncrement['mode'];
  let xrefObjnum: number | undefined;

  if (xrefText.startsWith('xref')) {
    mode = 'table';
    const trailerAt = xrefText.indexOf('trailer');
    if (trailerAt < 0) throw new Error('trailer not found');
    const lines = xrefText
      .slice(4, trailerAt)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let i = 0;
    while (i < lines.length) {
      const [startS, countS] = lines[i++].split(/\s+/);
      const start = parseInt(startS, 10);
      const count = parseInt(countS, 10);
      for (let k = 0; k < count; k++) {
        const [off, gen, kind] = lines[i++].split(/\s+/);
        entries.push({
          objnum: start + k,
          type: kind === 'n' ? 1 : 0,
          offset: parseInt(off, 10),
          gen: parseInt(gen, 10),
        });
      }
    }
    trailerBody = dictBody(xrefText.slice(trailerAt + 7));
  } else {
    mode = 'stream';
    const m = /^(\d+)\s+0\s+obj/.exec(xrefText);
    if (!m) throw new Error('xref stream object header not found');
    xrefObjnum = parseInt(m[1], 10);
    const dictStart = xrefText.indexOf('<<');
    const streamKw = xrefText.indexOf('stream', dictStart);
    const dictText = xrefText.slice(dictStart, streamKw);
    const w = readArray(dictText, 'W').map(Number);
    const index = readArray(dictText, 'Index').map(Number);
    const length = Number(readValue(dictText, 'Length'));
    if (w.length !== 3 || !Number.isFinite(length)) throw new Error('unsupported xref stream');
    const dataStart =
      xrefOffset - originalLength + streamKw + 'stream'.length + (xrefText[streamKw + 6] === '\r' ? 2 : 1);
    const data = tail.subarray(dataStart, dataStart + length);
    const rowLen = w[0] + w[1] + w[2];
    let pos = 0;
    const readField = (n: number) => {
      let v = 0;
      for (let b = 0; b < n; b++) v = v * 256 + data[pos++];
      return v;
    };
    for (let s = 0; s < index.length; s += 2) {
      for (let k = 0; k < index[s + 1]; k++) {
        const type = w[0] === 0 ? 1 : readField(w[0]);
        const f2 = readField(w[1]);
        const f3 = readField(w[2]);
        entries.push({ objnum: index[s] + k, type: type === 1 ? 1 : 0, offset: f2, gen: f3 });
        if (pos > rowLen * 100000) throw new Error('xref stream too large');
      }
    }
    trailerBody = dictBody(dictText);
  }

  // Cut out the objects in this increment in xref offset order
  const inUpdate = entries
    .filter((e) => e.type === 1 && e.offset >= originalLength && e.offset < xrefOffset)
    .sort((a, b) => a.offset - b.offset);
  const objects = new Map<number, Uint8Array>();
  inUpdate.forEach((e, i) => {
    const end = i + 1 < inUpdate.length ? inUpdate[i + 1].offset : xrefOffset;
    objects.set(e.objnum, trimEnd(full.subarray(e.offset, end)));
  });
  const free = entries.filter((e) => e.type === 0);
  return { mode, objects, free, trailerBody, xrefObjnum };
}

/** Assemble an increment without the objects identical to the baseline, after the original file */
export function writeSlimIncrement(
  original: Uint8Array,
  current: ParsedIncrement,
  baseline: ReadonlyMap<number, Uint8Array>,
): Uint8Array {
  const kept: { objnum: number; bytes: Uint8Array }[] = [];
  for (const [objnum, bytes] of current.objects) {
    if (objnum === current.xrefObjnum) continue;
    const base = baseline.get(objnum);
    if (base && sameBytes(base, bytes)) continue;
    kept.push({ objnum, bytes });
  }

  const parts: Uint8Array[] = [original];
  let offset = original.length;
  const last = original[original.length - 1];
  if (last !== 0x0a && last !== 0x0d) push(enc.encode('\r\n'));

  const written: XrefEntry[] = [];
  for (const { objnum, bytes } of kept) {
    written.push({ objnum, type: 1, offset, gen: 0 });
    push(bytes);
    push(enc.encode('\r\n'));
  }
  const xrefAt = offset;

  if (current.mode === 'table') {
    const all = [...current.free, ...written].sort((a, b) => a.objnum - b.objnum);
    let table = 'xref\r\n';
    for (const run of runs(all)) {
      table += `${run[0].objnum} ${run.length}\r\n`;
      for (const e of run) table += `${pad(e.offset, 10)} ${pad(e.gen, 5)} ${e.type === 1 ? 'n' : 'f'}\r\n`;
    }
    table += `trailer\r\n<<${current.trailerBody}>>\r\nstartxref\r\n${xrefAt}\r\n%%EOF\r\n`;
    push(enc.encode(table));
  } else {
    const objnum = current.xrefObjnum!;
    const all = [...current.free, ...written, { objnum, type: 1 as const, offset: xrefAt, gen: 0 }].sort(
      (a, b) => a.objnum - b.objnum,
    );
    const data = new Uint8Array(all.length * 7); // W [1 4 2]
    const index: number[] = [];
    all.forEach((e, i) => {
      data[i * 7] = e.type;
      data[i * 7 + 1] = (e.offset >>> 24) & 255;
      data[i * 7 + 2] = (e.offset >>> 16) & 255;
      data[i * 7 + 3] = (e.offset >>> 8) & 255;
      data[i * 7 + 4] = e.offset & 255;
      data[i * 7 + 5] = (e.gen >>> 8) & 255;
      data[i * 7 + 6] = e.gen & 255;
    });
    for (const run of runs(all)) index.push(run[0].objnum, run.length);
    const head = `${objnum} 0 obj\r\n<</Type/XRef/W[1 4 2]/Index[${index.join(' ')}]/Length ${data.length}${current.trailerBody}>>stream\r\n`;
    push(enc.encode(head));
    push(data);
    push(enc.encode(`\r\nendstream\r\nendobj\r\nstartxref\r\n${xrefAt}\r\n%%EOF\r\n`));
  }

  const out = new Uint8Array(offset);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;

  function push(bytes: Uint8Array) {
    parts.push(bytes);
    offset += bytes.length;
  }
}

// ---------------------------------------------------------------------------

/** Split into runs of consecutive objnums (for xref sections) */
function runs(entries: XrefEntry[]): XrefEntry[][] {
  const out: XrefEntry[][] = [];
  for (const e of entries) {
    const cur = out[out.length - 1];
    if (cur && cur[cur.length - 1].objnum + 1 === e.objnum) cur.push(e);
    else out.push([e]);
  }
  return out;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function trimEnd(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d || bytes[end - 1] === 0x20)) end--;
  return bytes.subarray(0, end);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * From the body of the trailer dictionary "<< ... >>", remove the entries about the xref itself
 * (/W /Index /Length /Filter /DecodeParms /Type) and return the rest.
 * PDFium's output only has values that are numbers / references / names / arrays / hex strings, so only those are handled.
 */
function dictBody(text: string): string {
  const start = text.indexOf('<<');
  if (start < 0) throw new Error('trailer dict not found');
  // Find the matching >> (handles nesting)
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') {
      depth++;
      i++;
    } else if (text[i] === '>' && text[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) {
        end = i - 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('trailer dict not closed');
  const body = text.slice(start + 2, end);
  const drop = new Set(['W', 'Index', 'Length', 'Filter', 'DecodeParms', 'Type']);
  let out = '';
  for (const [key, value] of dictEntries(body)) {
    if (!drop.has(key)) out += `/${key} ${value}`;
  }
  return out;
}

/** Split a dictionary body into [key, value source string] */
function dictEntries(body: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  const skipWs = () => {
    while (i < body.length && /\s/.test(body[i])) i++;
  };
  while (i < body.length) {
    skipWs();
    if (body[i] !== '/') break;
    let j = i + 1;
    while (j < body.length && /[^\s/\[\]<>()]/.test(body[j])) j++;
    const key = body.slice(i + 1, j);
    i = j;
    skipWs();
    const valueStart = i;
    if (body.startsWith('<<', i)) {
      let depth = 0;
      while (i < body.length) {
        if (body.startsWith('<<', i)) {
          depth++;
          i += 2;
        } else if (body.startsWith('>>', i)) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
    } else if (body[i] === '[') {
      let depth = 0;
      while (i < body.length) {
        if (body[i] === '[') depth++;
        else if (body[i] === ']') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
    } else if (body[i] === '<') {
      i = body.indexOf('>', i) + 1;
    } else if (body[i] === '/') {
      i++;
      while (i < body.length && /[^\s/\[\]<>()]/.test(body[i])) i++;
    } else {
      // a number or "n g R"
      while (i < body.length && /[^\s/\[\]<>()]/.test(body[i])) i++;
      const ref = /^\s+\d+\s+R/.exec(body.slice(i));
      if (ref) i += ref[0].length;
    }
    out.push([key, body.slice(valueStart, i).trim()]);
  }
  return out;
}

function readArray(dict: string, key: string): string[] {
  const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (!m) throw new Error(`/${key} not found`);
  return m[1].trim().split(/\s+/).filter(Boolean);
}

function readValue(dict: string, key: string): string {
  const m = new RegExp(`/${key}\\s+([^\\s/\\[<>]+)`).exec(dict);
  if (!m) throw new Error(`/${key} not found`);
  return m[1];
}
