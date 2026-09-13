import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * Builds the deployable directory.
 *
 * The functions import workspace packages, which only resolve inside this
 * monorepo, so each one is bundled into a self contained module. That way the
 * deployed artefact does not depend on how the host resolves a workspace
 * symlink, and what is tested here is what runs there.
 *
 * @netlify/blobs stays external: it is provided by the platform, and the app
 * falls back to a read only registry when it cannot be resolved.
 */

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const outDir = join(appDir, 'dist')

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(join(outDir, 'netlify', 'functions'), { recursive: true })

  const functionsDir = join(appDir, 'netlify', 'functions')
  const entries = (await readdir(functionsDir)).filter((file) => file.endsWith('.mts'))

  for (const entry of entries) {
    await build({
      entryPoints: [join(functionsDir, entry)],
      outfile: join(outDir, 'netlify', 'functions', entry.replace(/\.mts$/, '.mjs')),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      external: ['@netlify/blobs', '@netlify/functions'],
      logLevel: 'warning',
    })
  }

  await cp(join(appDir, 'public'), join(outDir, 'public'), { recursive: true })
  await cp(join(appDir, 'netlify.toml'), join(outDir, 'netlify.toml'))

  // Declared so the platform installs Blobs for the deployed functions. Every
  // other dependency is already inlined by the bundle above.
  await writeFile(
    join(outDir, 'package.json'),
    `${JSON.stringify(
      { name: 'showing-up-web-deploy', private: true, type: 'module', dependencies: { '@netlify/blobs': '^11.0.3' } },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(`built ${entries.length} functions into ${outDir}`)
  for (const entry of entries) console.log(`  ${entry.replace(/\.mts$/, '.mjs')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
