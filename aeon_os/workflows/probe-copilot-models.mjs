import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function copilotExecutable() {
  const found = spawnSync('where.exe', ['copilot'], { encoding: 'utf8', windowsHide: true })
  const executable = found.stdout?.split(/\r?\n/).find(path => path.toLowerCase().endsWith('.exe'))
  if (found.status !== 0 || !executable) throw new Error('Copilot executable was not found')
  return executable
}

export async function listCopilotModels(binary = copilotExecutable()) {
  const env = { ...process.env, NODE_USE_SYSTEM_CA: '1', NODE_TLS_REJECT_UNAUTHORIZED: '1' }
  for (const name of ['KAIROS_AEON_API_KEY', 'AEON_API_KEY', 'KAIROS_CALLBACK_TOKEN', 'KAIROS_WORKER_SECRET', 'AEON_MCP_TOKEN']) delete env[name]
  const child = spawn(binary, ['--headless', '--no-auto-update', '--stdio', '--log-level', 'none'], {
    windowsHide: true, env, stdio: ['pipe', 'pipe', 'ignore'],
  })
  let buffer = Buffer.alloc(0)
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Copilot model discovery timed out after 30 seconds')), 30_000)
      const send = (id, method, params) => {
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
        child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
      }
      child.once('error', () => reject(new Error('Could not start Copilot model discovery')))
      child.stdin.on('error', () => reject(new Error('Copilot model discovery input closed')))
      child.once('exit', code => reject(new Error(`Copilot model discovery exited before responding (${code})`)))
      child.stdout.on('data', chunk => {
        try {
          buffer = Buffer.concat([buffer, chunk])
          if (buffer.length > 2_000_000) throw new Error('Copilot model discovery exceeded its response limit')
          while (true) {
            const split = buffer.indexOf('\r\n\r\n')
            if (split < 0) return
            const header = buffer.subarray(0, split).toString('ascii')
            const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1])
            if (!Number.isInteger(length) || length < 0 || length > 2_000_000) throw new Error('Invalid Copilot model response framing')
            if (buffer.length < split + 4 + length) return
            const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString('utf8'))
            buffer = buffer.subarray(split + 4 + length)
            if (message.id !== 1 && message.id !== 2) continue
            if (message.error) throw new Error(`Copilot ${message.id === 1 ? 'connection' : 'model listing'} failed; check CLI authentication`)
            if (message.id === 1) send(2, 'models.list', {})
            else {
              const models = message.result?.models
              if (!Array.isArray(models) || !models.length || models.some(model => typeof model.id !== 'string' || typeof model.name !== 'string')) throw new Error('Copilot returned no valid model catalog')
              resolve(models.map(({ id, name }) => ({ id, name })))
            }
          }
        } catch (error) { reject(error) }
      })
      send(1, 'connect', { supportedTaskKinds: ['agent', 'client', 'shell'] })
    })
  } finally {
    clearTimeout(timer)
    child.stdin.destroy()
    child.stdout.destroy()
    child.kill()
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), models: await listCopilotModels() }, null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
