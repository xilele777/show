import { describe, expect, it } from 'vitest'
import { normalizeProgramItem, recordSchema, formatCredits } from '../src/lib/schema'
import { groupProgram, parseProgramText } from '../src/lib/program'
import { createRecordSchema, changesSchema } from '../mcp/archive'
import { filterRecords } from '../src/lib/filters'
import { archiveFixture } from './fixtures/archive'

const table = `### 上半场
| 序号 | 曲目名称 | 剧目出处 | 作词 | 作曲 | 演唱 |
| --- | --- | --- | --- | --- | --- |
| 1 | 红梅赞 | 1964年歌剧《江姐》 | 阎肃 | 羊鸣、姜春阳、金砂 | 曹冬 |
| 2 | 紫藤花 | 1981年歌剧《伤逝》 | 王泉、韩伟 | 施光南 | 张莉莉、蒋立章 |

### 下半场
| 序号 | 曲目名称 | 剧目出处 | 作词 | 作曲 | 演唱 |
| --- | --- | --- | --- | --- | --- |
| 1 | 乡谣 | 2007年歌剧《野火春风斗古城》 | 王晓岭 | 张卓娅、王祖皆 | 徐森 |`

describe('complete program and personnel data', () => {
  it('reads older records and program formats without losing their existing fields', () => {
    const old = JSON.parse(JSON.stringify(archiveFixture.records[0]))
    delete old.cast
    delete old.subtitle
    delete old.time
    old.program = ['旧曲目', { title: '旧唱段', composer: '作曲家', half: '上半场' }]
    const parsed = recordSchema.parse(old)
    expect(parsed.cast).toEqual([])
    expect(parsed.subtitle).toBe('')
    expect(parsed.time).toBe('')
    expect(parsed.artist).toBe(old.artist)
    expect(parsed.note).toBe(old.note)
    expect(normalizeProgramItem(parsed.program[0]!)).toMatchObject({
      title: '旧曲目',
      source: '',
      performers: []
    })
    expect(normalizeProgramItem(parsed.program[1]!)).toMatchObject({
      title: '旧唱段',
      composer: '作曲家',
      half: '上半场'
    })
  })

  it('imports full tables in order and preserves multiple writers and performers', () => {
    const program = parseProgramText(table)
    expect(program).toHaveLength(3)
    expect(program[0]).toEqual({
      title: '红梅赞',
      source: '1964年歌剧《江姐》',
      lyricist: '阎肃',
      composer: '羊鸣、姜春阳、金砂',
      performers: ['曹冬'],
      section: '',
      credits: [],
      description: '',
      half: '上半场'
    })
    expect(program[1]!.performers).toEqual(['张莉莉', '蒋立章'])
    expect(program[1]!.lyricist).toBe('王泉、韩伟')
    expect(program[2]!.half).toBe('下半场')
  })

  it('accepts escaped table text and the original simple text format', () => {
    expect(parseProgramText(table.replace(/\|/g, '\\|').replace(/###/g, '\\###'))).toEqual(
      parseProgramText(table)
    )
    expect(parseProgramText('上半场\n贝多芬 · 第五交响曲\n下半场\n独唱')).toMatchObject([
      { title: '第五交响曲', composer: '贝多芬', half: '上半场' },
      { title: '独唱', composer: '', half: '下半场' }
    ])
  })

  it('rejects incomplete table rows instead of silently losing columns', () => {
    expect(() => parseProgramText('| 曲目名称 | 作曲 |\n| 红梅赞 |')).toThrow('列数')
    expect(() => parseProgramText('| 红梅赞 | 羊鸣 |')).toThrow('表头')
    expect(() => parseProgramText('| 曲目名称 | 作曲 |\n| | 羊鸣 |')).toThrow('空白曲目')
  })

  it('keeps repeated subsections in place and numbers continuously within each half', () => {
    const program = [
      { title: '牧歌', half: '上半场' as const, section: '混声合唱' },
      { title: '步调', half: '上半场' as const, section: '混声合唱' },
      { title: '美丽的神话', half: '上半场' as const, section: '呼麦表演' },
      { title: '喜欢你', half: '上半场' as const, section: '混声合唱' },
      { title: '我从草原来', half: '下半场' as const, section: '女声合唱' }
    ]
    const groups = groupProgram(program)
    expect(groups.map(({ half, section, start }) => ({ half, section, start }))).toEqual([
      { half: '上半场', section: '混声合唱', start: 1 },
      { half: '上半场', section: '呼麦表演', start: 3 },
      { half: '上半场', section: '混声合唱', start: 4 },
      { half: '下半场', section: '女声合唱', start: 1 }
    ])
    expect(groups.flatMap((group) => group.items.map((item) => item.title))).toEqual(
      program.map((item) => item.title)
    )
  })

  it('preserves time and detailed credits through import, JSON saves and searches', () => {
    const program = parseProgramText(
      '| 曲目 | 表演形式 | 出处 | 编曲 | 领唱 | 马头琴伴奏 | 节目说明 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 牧歌 | 混声合唱 | 内蒙古民歌 | 瞿希贤 | 乌日罕 | 韩牟人 | 资助说明 |'
    )
    expect(program[0]).toMatchObject({
      title: '牧歌',
      section: '混声合唱',
      source: '内蒙古民歌',
      composer: '',
      performers: [],
      credits: [
        { role: '编曲', name: '瞿希贤' },
        { role: '领唱', name: '乌日罕' },
        { role: '马头琴伴奏', name: '韩牟人' }
      ],
      description: '资助说明'
    })
    const record = recordSchema.parse({ ...archiveFixture.records[0], time: '19:30', program })
    expect(recordSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record)
    for (const q of ['混声合唱', '瞿希贤', '马头琴伴奏', '资助说明']) {
      expect(filterRecords([record], { q, year: '', city: '', type: '', status: '' })).toHaveLength(1)
    }
    for (const time of ['24:00', '19:60', '9:30']) {
      expect(() =>
        createRecordSchema.parse({ title: '测试', date: '2026-10-13', city: '长沙', type: 'sing', time })
      ).toThrow('HH:mm')
    }
  })

  it('rejects tables in personal thoughts and repeated personnel lists in subtitle fields', () => {
    const basic = { title: '测试演出', date: '2026-11-04', city: '长沙', type: 'sing' }
    expect(() => createRecordSchema.parse({ ...basic, note: table })).toThrow('个人感想')
    expect(() => changesSchema.parse({ note: table })).toThrow('program')
    const cast = [{ name: '曹冬' }, { name: '张莉莉' }]
    expect(() => createRecordSchema.parse({ ...basic, cast, subtitle: '曹冬、张莉莉' })).toThrow('演员名单')
    expect(() => changesSchema.parse({ cast, artist: '曹冬、张莉莉' })).toThrow('演员名单')
    expect(
      createRecordSchema.parse({ ...basic, cast, note: '《红梅赞》的演唱让我很感动。' }).cast[0]!.role
    ).toBe('')
    expect(() =>
      createRecordSchema.parse({ ...basic, program: [{ title: '红梅赞', singer: '曹冬' }] })
    ).toThrow()
  })

  it('keeps complete details through JSON saves and searches names, source and lyrics', () => {
    const record = recordSchema.parse({
      ...archiveFixture.records[0],
      artist: '',
      orchestra: '',
      conductor: '',
      soloists: [],
      cast: [{ name: '曹冬' }, { name: '蒋立章' }],
      subtitle: '中国歌剧咏叹之夜',
      program: parseProgramText(table)
    })
    const saved = recordSchema.parse(JSON.parse(JSON.stringify(record)))
    expect(saved).toEqual(record)
    expect(formatCredits(saved)).toBe('2位演出人员')
    for (const q of ['曹冬', '王晓岭', '《伤逝》', '中国歌剧咏叹之夜']) {
      expect(filterRecords([saved], { q, year: '', city: '', type: '', status: '' })).toHaveLength(1)
    }
  })
})
