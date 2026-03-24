export interface CompactableLayoutItem {
  layout: {
    x: number
    y: number
    w: number
    h: number
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
  }
}

export function compactGridItems<T extends CompactableLayoutItem>(items: T[], cols = 24): T[] {
  const columnHeights = new Array(cols).fill(0)

  const findBestPosition = (width: number) => {
    let bestX = 0
    let bestY = Number.MAX_SAFE_INTEGER

    for (let x = 0; x <= cols - width; x += 1) {
      const candidateY = Math.max(...columnHeights.slice(x, x + width))
      if (candidateY < bestY) {
        bestY = candidateY
        bestX = x
      }
    }

    return { x: bestX, y: bestY }
  }

  return items.map((item) => {
    const minW = item.layout.minW ?? 1
    const minH = item.layout.minH ?? 1
    const width = Math.min(Math.max(item.layout.w || minW, minW), cols)
    const height = Math.max(item.layout.h || minH, minH)
    const { x, y } = findBestPosition(width)

    for (let col = x; col < x + width; col += 1) {
      columnHeights[col] = y + height
    }

    return {
      ...item,
      layout: {
        ...item.layout,
        x,
        y,
        w: width,
        h: height,
        minW,
        minH,
      },
    }
  })
}
