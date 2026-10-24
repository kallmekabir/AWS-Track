// Map pins drawn on a canvas on demand (Map.setMissingStyleImageResolver), so they use
// the dashboard's own typeface and shapes instead of the style's glyph server.
//   pin|<status>|<place in line, 0 = no number>|<selected 0/1>
import type { Status } from '../api'
import { INK, LEVEL_COLORS, ON_LEVEL } from './colors'

const PIXEL_RATIO = 2
const NUMBER_FONT = '700 13px "Barlow Semi Condensed"'
const SMALL_NUMBER_FONT = '700 11px "Barlow Semi Condensed"'

export function pinId(status: Status, place: number, selected: boolean): string {
  return `pin|${status}|${place}|${selected ? 1 : 0}`
}

export interface DrawnImage {
  data: ImageData
  pixelRatio: number
}

function radiusFor(status: Status, numbered: boolean): number {
  if (!numbered) return 6
  if (status === 'HELP_NOW') return 12.5
  if (status === 'OK_FOR_NOW' || status === 'NOT_CALLED') return 9.5
  return 11
}

function shape(ctx: CanvasRenderingContext2D, status: Status, cx: number, cy: number, r: number) {
  ctx.beginPath()
  if (status === 'PERSON_CHECK') {
    // A diamond reads smaller than a circle of the same radius, so it gets a little more.
    const d = r * 1.28
    ctx.moveTo(cx, cy - d)
    ctx.lineTo(cx + d, cy)
    ctx.lineTo(cx, cy + d)
    ctx.lineTo(cx - d, cy)
    ctx.closePath()
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
}

function drawPin(status: Status, place: number, selected: boolean): DrawnImage {
  const numbered = place > 0
  const r = radiusFor(status, numbered)
  const size = (r + 10) * 2
  const c = document.createElement('canvas')
  c.width = Math.ceil(size * PIXEL_RATIO)
  c.height = Math.ceil(size * PIXEL_RATIO)
  const ctx = c.getContext('2d')!
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO)
  const cx = size / 2
  const cy = size / 2

  if (selected) {
    ctx.beginPath()
    ctx.arc(cx, cy, r + 7.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = INK
    ctx.stroke()
  }

  // A 2px white ring keeps overlapping pins apart.
  shape(ctx, status, cx, cy, r + 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  shape(ctx, status, cx, cy, r)
  if (status === 'CALLING') {
    // On a call right now: an open ring.
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    shape(ctx, status, cx, cy, r - 1.5)
    ctx.lineWidth = 3
    ctx.strokeStyle = LEVEL_COLORS.CALLING
    ctx.stroke()
  } else {
    ctx.fillStyle = LEVEL_COLORS[status]
    ctx.fill()
  }

  if (numbered) {
    ctx.font = r >= 11 ? NUMBER_FONT : SMALL_NUMBER_FONT
    ctx.fillStyle = ON_LEVEL[status]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(place), cx, cy + 0.75)
  }
  return { data: ctx.getImageData(0, 0, c.width, c.height), pixelRatio: PIXEL_RATIO }
}

let fontsReady: Promise<unknown> | undefined

/** Draws the image for a style image id, or returns null for ids this module doesn't own. */
export async function drawImage(id: string): Promise<DrawnImage | null> {
  fontsReady ??= Promise.all([NUMBER_FONT, SMALL_NUMBER_FONT].map((f) => document.fonts.load(f)))
  await fontsReady
  const [kind, status, place, sel] = id.split('|')
  if (kind !== 'pin') return null
  return drawPin(status as Status, Number(place), sel === '1')
}
