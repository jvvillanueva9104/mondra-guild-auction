import { RewardType } from './types'

export type BoardCell = {
  name: string
  itemType: RewardType
  isFfa: boolean
}

export type BoardPage = {
  pageNumber: number
  rows: [BoardCell | null, BoardCell | null, BoardCell | null, BoardCell | null]
}

const ITEM_SHORT: Record<RewardType, string> = {
  puppet: 'Puppet',
  mvp: 'MVP',
  light_dark: 'L/D',
  time_space: 'T/S',
}

export function itemShortLabel(type: RewardType): string {
  return ITEM_SHORT[type]
}

type ResultLike = {
  page_number: number
  row_number: number
  item_type: RewardType
  member_id: string | null
  name: string
}

export function buildBoardPages(results: ResultLike[]): BoardPage[] {
  if (!results.length) return []

  const pageMap = new Map<number, Map<number, BoardCell>>()
  let maxPage = 0

  for (const r of results) {
    maxPage = Math.max(maxPage, r.page_number)
    if (!pageMap.has(r.page_number)) pageMap.set(r.page_number, new Map())
    pageMap.get(r.page_number)!.set(r.row_number, {
      name: r.name,
      itemType: r.item_type,
      isFfa: !r.member_id,
    })
  }

  const pages: BoardPage[] = []
  for (let p = 1; p <= maxPage; p++) {
    const rowMap = pageMap.get(p) ?? new Map()
    pages.push({
      pageNumber: p,
      rows: [1, 2, 3, 4].map(row => rowMap.get(row) ?? null) as BoardPage['rows'],
    })
  }
  return pages
}

export const BOARD_PAGES_PER_CHUNK = 20

export function chunkBoardPages(pages: BoardPage[], chunkSize = BOARD_PAGES_PER_CHUNK): BoardPage[][] {
  const chunks: BoardPage[][] = []
  for (let i = 0; i < pages.length; i += chunkSize) {
    chunks.push(pages.slice(i, i + chunkSize))
  }
  return chunks
}

export function displayBoardName(name: string, maxLen = 26): string {
  if (name === 'Free For All') return 'FFA'
  if (name.length <= maxLen) return name
  return `${name.slice(0, maxLen - 1)}…`
}

export function pageRangeLabel(pages: BoardPage[]): string {
  if (!pages.length) return ''
  return `PAGES ${pages[0].pageNumber}–${pages[pages.length - 1].pageNumber}`
}
