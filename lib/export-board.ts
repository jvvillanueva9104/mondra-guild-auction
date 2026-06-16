import { toPng } from 'html-to-image'

export async function downloadBoardPng(elementId: string, filename: string) {
  const node = document.getElementById(elementId)
  if (!node) throw new Error('Board not found')

  const clone = node.cloneNode(true) as HTMLElement
  clone.id = `${elementId}-export-clone`
  clone.style.position = 'fixed'
  clone.style.left = '-100000px'
  clone.style.top = '0'
  clone.style.zIndex = '-1'
  clone.style.width = '880px'
  clone.style.maxWidth = '880px'
  clone.style.overflow = 'visible'

  document.body.appendChild(clone)

  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const width = clone.scrollWidth
    const height = clone.scrollHeight

    const dataUrl = await toPng(clone, {
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
    clone.remove()
  }
}
