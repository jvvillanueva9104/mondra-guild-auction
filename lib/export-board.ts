import { toPng } from 'html-to-image'

export async function downloadBoardPng(elementId: string, filename: string) {
  const node = document.getElementById(elementId)
  if (!node) throw new Error('Board not found')

  const scroll = node.querySelector('.feather-board-scroll') as HTMLElement | null
  const columns = node.querySelector('.feather-board-columns') as HTMLElement | null
  const scrollPrev = scroll?.style.overflow ?? ''
  const columnsPrev = columns?.style.flexWrap ?? ''

  if (scroll) scroll.style.overflow = 'visible'
  if (columns) columns.style.flexWrap = 'wrap'

  try {
    const dataUrl = await toPng(node, {
      backgroundColor: '#0a0a0a',
      pixelRatio: 2,
      cacheBust: true,
    })

    const link = document.createElement('a')
    link.download = filename
    link.href = dataUrl
    link.click()
  } finally {
    if (scroll) scroll.style.overflow = scrollPrev
    if (columns) columns.style.flexWrap = columnsPrev
  }
}
