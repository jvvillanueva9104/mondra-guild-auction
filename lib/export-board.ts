import { toPng } from 'html-to-image'

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(img =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }),
    ),
  )
}

function waitForPaint() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function unlockOverflow(node: HTMLElement) {
  const restored: { el: HTMLElement; overflow: string; overflowY: string }[] = []
  let el: HTMLElement | null = node
  while (el) {
    restored.push({ el, overflow: el.style.overflow, overflowY: el.style.overflowY })
    el.style.overflow = 'visible'
    el.style.overflowY = 'visible'
    el = el.parentElement
  }
  return () => {
    for (const { el, overflow, overflowY } of restored) {
      el.style.overflow = overflow
      el.style.overflowY = overflowY
    }
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

async function captureElementPng(node: HTMLElement, pixelRatio: number): Promise<string> {
  node.scrollIntoView({ block: 'center' })
  await waitForImages(node)
  await waitForPaint()

  void node.offsetHeight

  const restoreOverflow = unlockOverflow(node)

  try {
    const width = Math.ceil(node.scrollWidth)
    const height = Math.ceil(node.scrollHeight)

    if (width <= 0 || height <= 0) {
      throw new Error('Board section has no visible size')
    }

    return await toPng(node, {
      backgroundColor: '#0a0a0a',
      pixelRatio,
      width,
      height,
      cacheBust: true,
    })
  } finally {
    restoreOverflow()
  }
}

export async function downloadBoardPng(elementId: string, filename: string) {
  const node = document.getElementById(elementId)
  if (!node) throw new Error('Board not found')

  const dataUrl = await captureElementPng(node, 2)
  downloadDataUrl(dataUrl, filename)
}

type ChunkProgress = (current: number, total: number) => void

export async function downloadBoardChunksForDiscord(
  boardId: string,
  filenameBase: string,
  onProgress?: ChunkProgress,
) {
  const board = document.getElementById(boardId)
  if (!board) throw new Error('Board not found')

  const columns = Array.from(board.querySelectorAll<HTMLElement>('.feather-board-column'))
  if (!columns.length) throw new Error('No board sections found')

  try {
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i]
      const title =
        column.querySelector('.feather-board-column-title')?.textContent?.trim() ??
        `part-${i + 1}`
      const slug = slugify(title) || `part-${i + 1}`

      column.classList.add('feather-board-column-exporting')
      await waitForPaint()
      void column.offsetHeight

      const dataUrl = await captureElementPng(column, 3)
      downloadDataUrl(dataUrl, `${filenameBase}-${slug}.png`)

      column.classList.remove('feather-board-column-exporting')

      onProgress?.(i + 1, columns.length)

      if (i < columns.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
  } finally {
    columns.forEach(column => column.classList.remove('feather-board-column-exporting'))
  }
}
