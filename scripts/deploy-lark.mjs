import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

const token = process.env.SWARMPIT_TOKEN?.trim()
const image = process.env.DEPLOY_IMAGE
const revision = process.env.DEPLOY_REVISION
if (!token || !/^[a-f0-9]{40}$/.test(revision ?? '') ||
    !new RegExp(`^galacticcouncil/protocol-viewer:${revision}@sha256:[a-f0-9]{64}$`).test(image ?? '')) {
  throw new Error('SWARMPIT_TOKEN, DEPLOY_IMAGE and DEPLOY_REVISION are required')
}

const compose = (await readFile(new URL('../docker/stack.lark.yml', import.meta.url), 'utf8'))
  .replace(/^(    image: ).+$/m, `$1${image}`)
const response = await fetch('https://swarmpit.lark.hydration.cloud/api/stacks/protocol-viewer', {
  method: 'POST',
  headers: {
    Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'protocol-viewer', spec: { compose } }),
  signal: AbortSignal.timeout(120_000),
})
if (!response.ok) throw new Error(`stack deployment failed: HTTP ${response.status}`)

const site = 'https://protocol-viewer.lark.hydration.cloud'
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const [version, health] = await Promise.all([
      fetch(`${site}/version.txt?revision=${revision}`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`${site}/healthz`, { signal: AbortSignal.timeout(10_000) }),
    ])
    if (version.ok && (await version.text()).trim() === revision &&
        health.ok && (await health.text()).trim() === 'ok') {
      console.log(`deployed ${revision} to ${site}`)
      process.exit(0)
    }
  } catch {
    // the proxy can briefly lose its backend during rollout
  }
  await setTimeout(5_000)
}
throw new Error(`deployment did not become healthy at revision ${revision}`)
