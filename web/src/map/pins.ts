// Map symbols drawn on a canvas on demand (Map.setMissingStyleImageResolver), so pins
// use the dashboard's own typeface and shapes instead of the style's glyph server.
//   pin|<group>|<rank, 0 = no number>|<selected 0/1>
//   hosp                     the navy "H" square (the US road sign for a hospital)
//   hlabel|<hospital_id>     a hospital's name, shown from zoom 13
import type { TriageGroup } from '../api/types'
import { INK, NAVY, ON_TRIAGE, TRIAGE_COLORS } from './colors'

const PIXEL_RATIO = 2
const NUMBER_FONT = '700 13px "Barlow Semi Condensed"'
const SMALL_NUMBER_FONT = '700 11px "Barlow Semi Condensed"'
const H_FONT = '700 15px "Barlow Condensed"'
const LABEL_FONT = '600 12px "Barlow Semi Condensed"'

export function pinId(group: TriageGroup, rank: number, selected: boolean): string {
  return `pin|${group}|${rank}|${selected ? 1 : 0}`
}

export interface DrawnImage {
  data: ImageData
  pixelRatio: number
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * PIXEL_RATIO)
  c.height = Math.ceil(h * PIXEL_RATIO)
  const ctx = c.getContext('2d')!
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO)
  return { c, ctx }
}

function finish(c: HTMLCanvasElement): DrawnImage {
  return { data: c.getContext('2d')!.getImageData(0, 0, c.width, c.height), pixelRatio: PIXEL_RATIO }
}

function radiusFor(group: TriageGroup, numbered: boolean): number {
  if (!numbered) return 6
  if (group === 'URGENT') return 12.5
  if (group === 'SAFE' || group === 'PENDING') return 9.5
  return 11
}

function shape(ctx: CanvasRenderingContext2D, group: TriageGroup, cx: number, cy: number, r: number) {
  ctx.beginPath()
  if (group === 'HUMAN_REVIEW') {
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

function drawPin(group: TriageGroup, rank: number, selected: boolean): DrawnImage {
  const numbered = rank > 0
  const r = radiusFor(group, numbered)
  const size = (r + 10) * 2
  const { c, ctx } = canvas(size, size)
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

  // A 2px surface ring keeps overlapping pins apart.
  shape(ctx, group, cx, cy, r + 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  shape(ctx, group, cx, cy, r)
  if (group === 'UNREACHED') {
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    shape(ctx, group, cx, cy, r - 1.5)
    ctx.lineWidth = 3
    ctx.strokeStyle = TRIAGE_COLORS.UNREACHED
    ctx.stroke()
  } else {
    ctx.fillStyle = TRIAGE_COLORS[group]
    ctx.fill()
  }

  if (numbered) {
    ctx.font = r >= 11 ? NUMBER_FONT : SMALL_NUMBER_FONT
    ctx.fillStyle = ON_TRIAGE[group]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(rank), cx, cy + 0.75)
  }
  return finish(c)
}

function drawHospital(): DrawnImage {
  const s = 26
  const { c, ctx } = canvas(s, s)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(0, 0, s, s, 6)
  ctx.fill()
  ctx.fillStyle = NAVY
  ctx.beginPath()
  ctx.roundRect(2, 2, s - 4, s - 4, 4)
  ctx.fill()
  ctx.font = H_FONT
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('H', s / 2, s / 2 + 1)
  return finish(c)
}

function drawLabel(text: string): DrawnImage {
  const probe = canvas(1, 1).ctx
  probe.font = LABEL_FONT
  const w = Math.ceil(probe.measureText(text).width) + 8
  const h = 18
  const { c, ctx } = canvas(w, h)
  ctx.font = LABEL_FONT
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3.5
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.strokeText(text, 4, h / 2)
  ctx.fillStyle = NAVY
  ctx.fillText(text, 4, h / 2)
  return finish(c)
}

let fontsReady: Promise<unknown> | undefined
function loadFonts() {
  fontsReady ??= Promise.all([NUMBER_FONT, SMALL_NUMBER_FONT, H_FONT, LABEL_FONT].map((f) => document.fonts.load(f)))
  return fontsReady
}

/** Draws the image for a style image id, or returns null for ids this module doesn't own. */
export async function drawImage(id: string, hospitalName: (hospitalId: string) => string | undefined): Promise<DrawnImage | null> {
  await loadFonts()
  const [kind, a, b, sel] = id.split('|')
  if (kind === 'pin') return drawPin(a as TriageGroup, Number(b), sel === '1')
  if (kind === 'hosp') return drawHospital()
  if (kind === 'hlabel') {
    const name = hospitalName(a)
    return name ? drawLabel(name) : null
  }
  return null
}
