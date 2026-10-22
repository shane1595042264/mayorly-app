// Builds every app and tray icon from the founder's hand-drawn 16x16 tomato
// (mayorly-assets/art/icon.tomato@1x.png). Integer nearest-neighbour scaling
// only, the same thing the game's camera zoom does; no pixel is invented.
// No ImageMagick, no iconutil: the PNG, ICO and ICNS containers are written here,
// so `npm run icon` gives the same bytes on Windows and macOS.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const src = 'build/tomato@1x.png'

// ---- PNG in: 8-bit or palette, non-interlaced -------------------------------

function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${src} is not a PNG`)
  let pos = 8
  let ihdr = null
  let plte = null
  let trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] }
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (!ihdr) throw new Error('no IHDR')
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported')
  const { width, height, bitDepth, colorType } = ihdr
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels || ![1, 2, 4, 8].includes(bitDepth) || (bitDepth < 8 && colorType !== 3 && colorType !== 0)) throw new Error(`unsupported PNG: colour type ${colorType}, ${bitDepth} bit`)

  const raw = inflateSync(Buffer.concat(idat))
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8)
  const bpp = Math.max(1, (channels * bitDepth) >> 3)
  const rows = Buffer.alloc(rowBytes * height)
  let prev = Buffer.alloc(rowBytes)
  let off = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[off++]
    const line = Buffer.from(raw.subarray(off, off + rowBytes))
    off += rowBytes
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`)
      line[i] = v & 0xff
    }
    line.copy(rows, y * rowBytes)
    prev = line
  }

  const gray = (v) => [v, v, v, 255]
  const palette = (i) => [plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], trns && i < trns.length ? trns[i] : 255]
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let px
      if (bitDepth < 8) {
        const perByte = 8 / bitDepth
        const byte = rows[y * rowBytes + Math.floor(x / perByte)]
        const idx = (byte >> (8 - bitDepth * (1 + (x % perByte)))) & ((1 << bitDepth) - 1)
        px = colorType === 3 ? palette(idx) : gray(Math.round(idx * (255 / ((1 << bitDepth) - 1))))
      } else {
        const i = y * rowBytes + x * channels
        px = colorType === 0 ? gray(rows[i])
          : colorType === 2 ? [rows[i], rows[i + 1], rows[i + 2], 255]
            : colorType === 3 ? palette(rows[i])
              : colorType === 4 ? [rows[i], rows[i], rows[i], rows[i + 1]]
                : [rows[i], rows[i + 1], rows[i + 2], rows[i + 3]]
      }
      rgba.set(px, (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

// ---- PNG out: 8-bit RGBA ------------------------------------------------------

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
const crc32 = (b) => {
  let c = -1
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng({ width, height, rgba }) {
  const rowLen = 1 + width * 4
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0
    rgba.copy(raw, y * rowLen + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Nearest-neighbour by a whole number. Every output pixel is a copy of one source pixel. */
function scale(img, k) {
  if (!Number.isInteger(k) || k < 1) throw new Error(`scale factor must be a whole number, got ${k}`)
  const width = img.width * k
  const height = img.height * k
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / k)
    for (let x = 0; x < width; x++) {
      const si = (sy * img.width + Math.floor(x / k)) * 4
      rgba.set(img.rgba.subarray(si, si + 4), (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

// ---- Containers ---------------------------------------------------------------

/** Windows .ico with PNG-compressed entries (supported since Vista). */
function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = header.length + dir.length
  pngs.forEach(({ size, png }, i) => {
    const e = i * 16
    dir[e] = size >= 256 ? 0 : size
    dir[e + 1] = size >= 256 ? 0 : size
    dir[e + 2] = 0
    dir[e + 3] = 0
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(png.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.png)])
}

/**
 * Apple's ARGB element (ic04, ic05): the four planes A, R, G, B in turn, each run-length
 * packed the icns way. iconutil writes the 16 and 32 point slots in this form and ignores
 * PNG there, so Finder's small sizes come out pixel for pixel only if we do the same.
 */
function encodeArgb({ width, height, rgba }) {
  const n = width * height
  const planes = [3, 0, 1, 2].map((c) => {
    const plane = Buffer.alloc(n)
    for (let i = 0; i < n; i++) plane[i] = rgba[i * 4 + c]
    return plane
  })
  const packed = []
  for (const plane of planes) {
    let i = 0
    while (i < plane.length) {
      let run = 1
      while (i + run < plane.length && plane[i + run] === plane[i] && run < 130) run++
      if (run >= 3) {
        packed.push(Buffer.from([0x80 + run - 3, plane[i]]))
        i += run
        continue
      }
      let j = i
      while (j < plane.length && j - i < 128) {
        let ahead = 1
        while (j + ahead < plane.length && plane[j + ahead] === plane[j] && ahead < 3) ahead++
        if (ahead >= 3) break
        j++
      }
      packed.push(Buffer.from([j - i - 1]), plane.subarray(i, j))
      i = j
    }
  }
  return Buffer.concat([Buffer.from('ARGB', 'latin1'), ...packed])
}

/** macOS .icns, the same element types iconutil writes from an .iconset. */
function encodeIcns(entries) {
  const parts = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

// ---- Build --------------------------------------------------------------------

const base = decodePng(readFileSync(src))
if (base.width !== 16 || base.height !== 16) throw new Error(`${src} should be 16x16, got ${base.width}x${base.height}`)
const png = (k) => encodePng(scale(base, k))
const at = (k) => ({ size: 16 * k, png: png(k) })

// Reference render, 64x. The macOS and Windows icons below carry their own sizes.
writeFileSync('build/icon.png', png(64))
// Tray: 2x. Windows uses it as is; macOS pairs it with tomato@1x.png as the 1x representation.
writeFileSync('build/tray.png', png(2))
// Windows: 16, 32, 48, 64, 128, 256 (1x, 2x, 3x, 4x, 8x, 16x).
writeFileSync('build/icon.ico', encodeIco([1, 2, 3, 4, 8, 16].map(at)))
// macOS: every slot Apple asks for is a whole multiple of 16.
writeFileSync('build/icon.icns', encodeIcns([
  { type: 'ic04', png: encodeArgb(scale(base, 1)) },  // 16
  { type: 'ic11', png: png(2) },                      // 16@2x
  { type: 'ic05', png: encodeArgb(scale(base, 2)) },  // 32
  { type: 'ic12', png: png(4) },                      // 32@2x
  { type: 'ic07', png: png(8) },                      // 128
  { type: 'ic13', png: png(16) },                     // 128@2x
  { type: 'ic08', png: png(16) },                     // 256
  { type: 'ic14', png: png(32) },                     // 256@2x
  { type: 'ic09', png: png(32) },                     // 512
  { type: 'ic10', png: png(64) },                     // 512@2x
]))
console.log('wrote build/icon.png (1024), build/tray.png (32), build/icon.ico, build/icon.icns')
