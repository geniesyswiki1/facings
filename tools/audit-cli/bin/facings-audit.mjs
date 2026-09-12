#!/usr/bin/env node
// Thin launcher: Phase 0 runs from TypeScript source through tsx so the
// observation code the audit log references is the code on disk.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, '../src/cli.ts')
const tsx = resolve(here, '../../../node_modules/tsx/dist/cli.mjs')

const result = spawnSync(process.execPath, [tsx, entry, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
