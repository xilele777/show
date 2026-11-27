import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server'

// Derive the project from this file, not the AI client's working directory.
const root = resolve(process.env.CONCSHOW_ROOT || fileURLToPath(new URL('../', import.meta.url)))
const server = createServer(root)
try {
  await server.connect(new StdioServerTransport())
} catch {
  console.error('Concshow MCP 启动失败，请检查 Node.js 24、依赖和项目路径')
  process.exitCode = 1
}
