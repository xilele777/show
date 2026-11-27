import { normalizeProgramItem, type ProgramItem } from './schema'

export function splitPerformerNames(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[、,，/；;]/)
        .map((name) => name.trim())
        .filter(Boolean)
    )
  ]
}

export function groupProgram(entries: Parameters<typeof normalizeProgramItem>[0][]) {
  const groups: {
    half: string
    section: string
    start: number
    items: (ProgramItem & { index: number })[]
  }[] = []
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const item = normalizeProgramItem(entry)
    const index = (counts.get(item.half) ?? 0) + 1
    counts.set(item.half, index)
    const last = groups.at(-1)
    if (last && last.half === item.half && last.section === item.section) {
      last.items.push({ ...item, index })
    } else {
      groups.push({ half: item.half, section: item.section, start: index, items: [{ ...item, index }] })
    }
  }
  return groups
}

// Accept complete program tables as well as the original one-song-per-line format.
// Parse the entire input before callers change a draft, so errors cannot leave partial rows.
export function parseProgramText(text: string): ProgramItem[] {
  const result: ProgramItem[] = []
  let half: ProgramItem['half'] = ''
  let columns: string[] | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/\\([|#-])/g, '$1')
      .replace(/\\$/, '')
      .trim()
    if (!line || /^(?:---+|\\|&#x20;\s*;?\|?)$/.test(line)) continue
    const section = /^(?:#{1,6}\s*)?(上半场|下半场|加演)[:：]?$/.exec(line)
    if (section) {
      half = section[1] as ProgramItem['half']
      columns = undefined
      continue
    }
    if (line.includes('|')) {
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
      if (cells.includes('曲目名称') || cells.includes('曲目')) {
        columns = cells
        continue
      }
      if (!cells.some(Boolean)) continue
      if (!columns) throw new Error('节目表需要「曲目名称」或「曲目」列，请保留表头后重新导入。')
      if (cells.length !== columns.length) throw new Error('节目表的列数与表头不一致，请检查后重新导入。')
      const field = (...labels: string[]) =>
        cells[columns!.findIndex((label) => labels.includes(label))] ?? ''
      const title = field('曲目名称', '曲目')
      if (!title) throw new Error('节目表中有空白曲目名称，请检查后重新导入。')
      result.push(
        normalizeProgramItem({
          title,
          composer: field('作曲', '作曲家'),
          lyricist: field('作词', '作词者'),
          source: field('剧目出处', '出处', '剧目'),
          section: field('小节', '节目分组', '表演形式'),
          description: field('节目说明'),
          credits: ['编曲', '改编', '领唱', '呼麦', '钢琴', '钢琴伴奏', '马头琴', '马头琴伴奏'].flatMap(
            (role) => splitPerformerNames(field(role)).map((name) => ({ name, role }))
          ),
          performers: splitPerformerNames(field('演唱', '演奏', '演唱者', '演奏者', '表演者')),
          half
        })
      )
      continue
    }
    const match = /^([^·—-]+?)\s*[·—-]\s*(.+)$/.exec(line)
    result.push(
      normalizeProgramItem(
        match && match[1]!.length <= 24
          ? { title: match[2]!.trim(), composer: match[1]!.trim(), half }
          : { title: line, half }
      )
    )
  }
  if (result.length > 100) throw new Error('单场节目单最多 100 首曲目。')
  return result
}
