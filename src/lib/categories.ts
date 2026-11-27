const palette = [
  { color: '#d97706', darkColor: '#fbbf24', soft: 'rgb(217 119 6 / 0.14)' }, // Amber Gold (音乐会)
  { color: '#e13c2a', darkColor: '#ff6b57', soft: 'rgb(225 60 42 / 0.14)' }, // Crimson Stage (演唱会)
  { color: '#0d9488', darkColor: '#2dd4bf', soft: 'rgb(13 148 136 / 0.15)' }, // Teal Meadow (音乐节)
  { color: '#7c3aed', darkColor: '#a78bfa', soft: 'rgb(124 58 237 / 0.15)' }, // Electric Violet (Livehouse)
  { color: '#2563eb', darkColor: '#60a5fa', soft: 'rgb(37 99 235 / 0.14)' }, // Cobalt Blue
  { color: '#db2777', darkColor: '#f472b6', soft: 'rgb(219 39 119 / 0.14)' } // Rose Magenta
] as const

const presets: Record<string, number> = {
  音乐会: 0,
  演唱会: 1,
  音乐节: 2,
  Livehouse: 3,
  其他: 4
}

export function categoryStyle(category: string): Record<string, string> {
  let idx = presets[category]
  if (idx === undefined) {
    let hash = 0
    for (let i = 0; i < category.length; i++) {
      hash = (hash * 31 + category.charCodeAt(i)) >>> 0
    }
    idx = hash % palette.length
  }
  const swatch = palette[idx] ?? palette[0]
  return {
    '--cat-color': swatch.color,
    '--cat-color-dark': swatch.darkColor,
    '--cat-soft': swatch.soft
  }
}
