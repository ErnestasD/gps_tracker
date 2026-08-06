#!/usr/bin/env node
/**
 * WOFF(1) → TTF, in ~50 lines of node builtins.
 *
 * jsPDF can embed a TTF and nothing else, and this repo ships only woff/woff2 (via @fontsource) —
 * which is why the PDF export transliterated `ą č ž ł` to ASCII instead of rendering them. woff2 is
 * Brotli plus a glyph transform and genuinely needs a library; **woff1 is just the sfnt tables,
 * each optionally zlib-deflated**, behind a 44-byte header. Undoing that is arithmetic, so it needs
 * no dependency and no ADR.
 *
 * Run: node tools/woff2ttf/index.mjs <in.woff> <out.ttf>
 * Used once to generate apps/web/src/assets/inter-latin-ext.ttf.base64 — kept in the tree so the
 * asset is reproducible rather than a binary someone downloaded from somewhere.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const [, , input, output] = process.argv
if (input === undefined || output === undefined) {
  console.error('usage: woff2ttf <in.woff> <out.ttf>')
  process.exit(2)
}

const woff = readFileSync(input)
if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a woff file (bad signature)')
const flavor = woff.readUInt32BE(4) // the sfnt version the TTF must carry (0x00010000 or 'OTTO')
const numTables = woff.readUInt16BE(12)

// directory: 20 bytes per table — tag, offset, compLength, origLength, origChecksum
const tables = []
for (let i = 0; i < numTables; i++) {
  const p = 44 + i * 20
  tables.push({
    tag: woff.subarray(p, p + 4),
    offset: woff.readUInt32BE(p + 4),
    compLength: woff.readUInt32BE(p + 8),
    origLength: woff.readUInt32BE(p + 12),
    checksum: woff.readUInt32BE(p + 16),
  })
}

// a table is stored deflated when compLength < origLength, and stored raw when they are equal
const data = tables.map((t) => {
  const raw = woff.subarray(t.offset, t.offset + t.compLength)
  return t.compLength < t.origLength ? inflateSync(raw) : raw
})

// sfnt header: version, numTables, and the binary-search fields (searchRange/entrySelector/rangeShift)
const entrySelector = Math.floor(Math.log2(numTables))
const searchRange = 2 ** entrySelector * 16
const header = Buffer.alloc(12)
header.writeUInt32BE(flavor, 0)
header.writeUInt16BE(numTables, 4)
header.writeUInt16BE(searchRange, 6)
header.writeUInt16BE(entrySelector, 8)
header.writeUInt16BE(numTables * 16 - searchRange, 10)

// tables must be 4-byte aligned and the directory must be sorted by tag, as in any sfnt
const order = tables.map((t, i) => i).sort((a, b) => tables[a].tag.compare(tables[b].tag))
const dir = Buffer.alloc(numTables * 16)
const body = []
let offset = 12 + numTables * 16
order.forEach((idx, slot) => {
  const t = tables[idx]
  const d = data[idx]
  tables[idx].tag.copy(dir, slot * 16)
  dir.writeUInt32BE(t.checksum, slot * 16 + 4)
  dir.writeUInt32BE(offset, slot * 16 + 8)
  dir.writeUInt32BE(t.origLength, slot * 16 + 12)
  const pad = (4 - (d.length % 4)) % 4
  body.push(d, Buffer.alloc(pad))
  offset += d.length + pad
})

writeFileSync(output, Buffer.concat([header, dir, ...body]))
console.log(`${input} → ${output}: ${numTables} tables, ${offset} bytes`)
