/**
 * Generates the extension icons (16/32/48/128 px) as PNG files without any image library:
 * a rounded shield with a diagonal "no" bar, drawn with anti-aliased signed-distance sampling.
 */

import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZES = [16, 32, 48, 128]
const BACKGROUND = [37, 99, 235] as const
const FOREGROUND = [255, 255, 255] as const
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons')

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Signed distance to a rounded rectangle centred on the origin. */
function roundedRectDistance(x: number, y: number, halfWidth: number, halfHeight: number, radius: number): number {
  const dx = Math.abs(x) - halfWidth + radius
  const dy = Math.abs(y) - halfHeight + radius
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Coverage in [0,1] of the icon shapes at pixel (px, py) for a canvas of `size` px. */
function sample(px: number, py: number, size: number): { background: number; foreground: number } {
  const x = px - size / 2
  const y = py - size / 2
  const unit = size / 32
  const edge = 0.8 * unit

  const tile = roundedRectDistance(x, y, size / 2, size / 2, size * 0.22)
  const background = clamp01(0.5 - tile / edge)

  const ring = Math.abs(Math.hypot(x, y) - 10 * unit) - 2.2 * unit
  const barDistance = Math.abs(x - y) / Math.SQRT2 - 2 * unit
  const barClip = Math.hypot(x, y) - 10 * unit
  const bar = Math.max(barDistance, barClip)
  const foreground = clamp01(0.5 - Math.min(ring, bar) / edge)

  return { background, foreground }
}

function renderRgba(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0
      let foreground = 0
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        const coverage = sample(px + ox, py + oy, size)
        background += coverage.background / 4
        foreground += coverage.foreground / 4
      }
      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const base = BACKGROUND[channel as 0 | 1 | 2]
        const accent = FOREGROUND[channel as 0 | 1 | 2]
        pixels[offset + channel] = Math.round(base + (accent - base) * foreground)
      }
      pixels[offset + 3] = Math.round(255 * background)
    }
  }
  return pixels
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData) >>> 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = size * 4
  const filtered = Buffer.alloc((stride + 1) * size)
  for (let row = 0; row < size; row += 1) {
    filtered[row * (stride + 1)] = 0
    rgba.copy(filtered, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(filtered, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size, renderRgba(size)))
}
console.log(`generated ${SIZES.length} icons in ${outDir}`)
