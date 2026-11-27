import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { archiveFixture } from './fixtures/archive'

it('initializes an actual stdio MCP process, lists tools, and performs validated batch writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'concshow-mcp-stdio-'))
  await mkdir(join(root, 'public/content'), { recursive: true })
  await writeFile(join(root, 'public/content/archive.json'), JSON.stringify(archiveFixture))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      fileURLToPath(new URL('../mcp/index.ts', import.meta.url))
    ],
    cwd: tmpdir(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
      CONCSHOW_ROOT: root
    },
    stderr: 'pipe'
  })
  let errors = ''
  transport.stderr?.on('data', (chunk) => {
    errors += chunk.toString()
  })
  const client = new Client({ name: 'integration-test', version: '1.0.0' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      'sync_archive',
      'archive_overview',
      'list_concerts',
      'get_concert',
      'create_concerts',
      'update_concerts',
      'upload_images',
      'publish_archive'
    ])
    const resources = await client.listResources()
    expect(resources.resources[0]!.uri).toBe('concshow://input-guide')
    const overview = await client.callTool({ name: 'archive_overview', arguments: {} })
    expect(overview.isError).toBeFalsy()
    const value = JSON.parse((overview.content as { text: string }[])[0]!.text)
    expect(value.fieldSemantics.note).toContain('个人观演感想')
    expect(value.optionalFields).toContain('cast')
    const createTool = tools.find((tool) => tool.name === 'create_concerts')!
    expect(JSON.stringify(createTool.inputSchema)).toContain('不得填入演员名单')
    const create = await client.callTool({
      name: 'create_concerts',
      arguments: {
        expectedRevision: value.revision,
        records: [
          {
            title: '中文测试演出',
            date: '2025-06-01',
            city: '上海',
            type: '音乐会',
            cast: [{ name: '演出人员甲' }],
            subtitle: '特别场',
            program: [
              {
                title: '红梅赞',
                source: '1964年歌剧《江姐》',
                lyricist: '阎肃',
                composer: '羊鸣、姜春阳、金砂',
                performers: ['曹冬'],
                half: '下半场'
              }
            ]
          }
        ]
      }
    })
    expect(create.isError, errors).toBeFalsy()
    const created = JSON.parse((create.content as { text: string }[])[0]!.text)
    expect(created.created[0].program[0].performers).toEqual(['曹冬'])
    expect(created.created[0].cast).toEqual([{ name: '演出人员甲', role: '' }])
    expect(created.created[0].note).toBe('')
    const updated = await client.callTool({
      name: 'update_concerts',
      arguments: { updates: [{ id: created.created[0].id, changes: { note: '真实感想' } }] }
    })
    expect(updated.isError).toBeFalsy()
    const get = await client.callTool({ name: 'get_concert', arguments: { id: created.created[0].id } })
    const saved = JSON.parse((get.content as { text: string }[])[0]!.text).record
    expect(saved.program[0].source).toBe('1964年歌剧《江姐》')
    expect(saved.program[0].lyricist).toBe('阎肃')
    const performerSearch = await client.callTool({ name: 'list_concerts', arguments: { query: '曹冬' } })
    expect(JSON.parse((performerSearch.content as { text: string }[])[0]!.text).total).toBe(1)
    const failed = await client.callTool({
      name: 'create_concerts',
      arguments: {
        records: [{ title: '无效', date: '2025-02-30', city: '上海', type: '音乐会' }]
      }
    })
    expect(failed.isError).toBe(true)
    const list = await client.callTool({ name: 'list_concerts', arguments: { query: '中文测试' } })
    expect(JSON.parse((list.content as { text: string }[])[0]!.text).total).toBe(1)
    const content = JSON.parse(await readFile(join(root, 'public/content/archive.json'), 'utf8'))
    expect(content.records).toHaveLength(3)
  } finally {
    await client.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
