// Contrast helpers for contrast.test.ts (AD-9). Colours are #rrggbb or #rrggbbaa.
export type Rgb = [number, number, number]

export function parseHex(hex: string): { rgb: Rgb; alpha: number } {
  const h = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new Error(`not a hex colour: ${hex}`)
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 }
}

/** `top` laid over the opaque `ground` (a translucent token is measured after blending). */
export function blend(top: string, ground: Rgb): Rgb {
  const { rgb, alpha } = parseHex(top)
  return [0, 1, 2].map((i) => rgb[i] * alpha + ground[i] * (1 - alpha)) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
