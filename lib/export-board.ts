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

export async function downloadBoardPng(elementId: string, filename: string) {
  const node = document.getElementById(elementId)
  if (!node) throw new Error('Board not found')

  node.scrollIntoView({ block: 'start' })
  await waitForImages(node)
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const restoreOverflow = unlockOverflow(node)

  try {
    const width = Math.ceil(node.scrollWidth)
    const height = Math.ceil(node.scrollHeight)

    const dataUrl = await toPng(node, {
      backgroundColor: '#0a0a0a',
      pixelRatio: 2,
      width,
      height,
      cacheBust: true,
    })

    const link = document.createElement('a')
    link.download = filename
    link.href = dataUrl
    link.click()
  } finally {
    restoreOverflow()
  }
}
