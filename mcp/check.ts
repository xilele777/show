import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    '--use-env-proxy',
    '--import',
    new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
    fileURLToPath(new URL('./index.ts', import.meta.url))
  ],
  env: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ),
  stderr: 'pipe'
})
const client = new Client({ name: 'concshow-check', version: '1.0.0' })
transport.stderr?.on('data', (chunk) => process.stderr.write(chunk))
try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  console.log(`MCP 连接成功，${tools.length} 个工具：${tools.map((tool) => tool.name).join(', ')}`)
  const overview = await client.callTool({ name: 'archive_overview', arguments: {} })
  if (overview.isError) throw new Error('档案读取失败')
  console.log(JSON.stringify(overview.content, null, 2))
  if (process.argv.includes('--sync')) {
    const synced = await client.callTool({ name: 'sync_archive', arguments: {} }, undefined, {
      timeout: 120_000
    })
    console.log(JSON.stringify(synced.content, null, 2))
    if (synced.isError) throw new Error('GitHub 档案同步失败')
  }
  if (process.argv.includes('--publish-preview')) {
    const preview = await client.callTool(
      { name: 'publish_archive', arguments: { dryRun: true } },
      undefined,
      { timeout: 120_000 }
    )
    console.log(JSON.stringify(preview.content, null, 2))
    if (preview.isError) throw new Error('GitHub 发布预览失败')
  }
} finally {
  await client.close()
}
