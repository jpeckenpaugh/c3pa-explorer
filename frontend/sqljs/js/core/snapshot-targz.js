/* C3PA Explorer browser edition — snapshot tar.gz extraction.
 *
 * The v1-alpha delivery is a single-entry tar.gz: `explorer.tar.gz` wrapping
 * `explorer.db`, produced by the Colab notebook. This extracts that single .db
 * with zero vendored dependencies, using browser-native primitives only:
 *
 *   inflate  — DecompressionStream('gzip') (Chrome native; also present in Node,
 *              which is ONLY our test runner — this module has no runtime dep)
 *   tar walk — fixed 512-byte record scan; octal size at offset 124, data
 *              padded to 512, next block at 512 + padding
 *
 * Scope is deliberately small (per the plan): one .db entry, gzip'd tar, no
 * base-256 sizes (>8 GiB), no sparse/pax extensions needed for our artifacts.
 * Anything outside that fails loudly with a clear message.
 */

"use strict";

const GZIP_MAGIC = [0x1f, 0x8b];
const TAR_BLOCK = 512;
const NAME_OFF = 0, NAME_LEN = 100, SIZE_OFF = 124, TYPE_OFF = 156, PREFIX_OFF = 345;

/** True when `bytes` starts with gzip magic (1f 8b). */
export function isGzipBytes(bytes) {
  return !!bytes && bytes.byteLength >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/** True when `bytes` starts with gzip magic AND the uncompressed stream parses
 *  as a tar containing a *.db member. (Cheap pre-check: gzip magic only.) */
export function isTarGzBytes(bytes) {
  return isGzipBytes(bytes);
}

/** Inflate a gzip stream (bytes 1f 8b ...) into a raw byte array. */
export async function inflateGzip(compressed) {
  const inflater = new DecompressionStream("gzip");
  const writer = inflater.writable.getWriter();
  const reader = inflater.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    writer.write(compressed);
    writer.close();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value);
      chunks.push(copy);
      total += copy.byteLength;
    }
  } finally {
    if (typeof reader.release === "function") reader.release();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function parseOctal(bytes, off, len) {
  // tar stores sizes/perms as NUL-padded octal ASCII; spaces are padding.
  let s = "";
  for (let i = off; i < off + len && i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b === 0 || b === 0x20) break;
    s += String.fromCharCode(b);
  }
  return s ? parseInt(s, 8) : 0;
}

/** Extract the single *.db member from a gzip-compressed tar archive. */
export async function extractSingleDbFromTarGz(bytes) {
  if (!isGzipBytes(bytes)) throw new Error("not a gzip archive");
  const flat = await inflateGzip(bytes);

  let pos = 0;
  let found = null;
  while (pos + TAR_BLOCK <= flat.byteLength) {
    // two zero blocks = end of archive
    const zero = flat[pos] === 0 && flat[pos + TAR_BLOCK - 1] === 0;
    if (zero) break;

    const size = parseOctal(flat, pos + SIZE_OFF, 12);
    const typeflag = flat[pos + TYPE_OFF];
    const nameBytes = flat.slice(pos + NAME_OFF, pos + NAME_OFF + NAME_LEN);
    let name = "";
    for (const b of nameBytes) {
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    if (pos + PREFIX_OFF < flat.byteLength) {
      const pfxBytes = flat.slice(pos + PREFIX_OFF, pos + PREFIX_OFF + 155);
      let pfx = "";
      for (const b of pfxBytes) {
        if (b === 0) break;
        pfx += String.fromCharCode(b);
      }
      if (pfx) name = pfx + "/" + name;
    }

    const dataPos = pos + TAR_BLOCK;
    if (name.toLowerCase().endsWith(".db") && typeflag !== 53 /* '5' dir */) {
      found = { name, bytes: flat.slice(dataPos, dataPos + size) };
    }

    // advance: header + data, padded up to the next 512 boundary
    const padded = (size + TAR_BLOCK - 1) & ~(TAR_BLOCK - 1);
    pos = dataPos + padded;
    if (pos < dataPos) break; // overflow guard against corrupt input
  }

  if (!found) throw new Error("no .db file found inside the snapshot tar.gz");
  return found;
}