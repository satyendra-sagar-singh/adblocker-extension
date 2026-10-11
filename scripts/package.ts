/**
 * Zips dist/ into adblocker-extension-<version>.zip for upload to the Chrome Web Store.
 * Run `npm run build` first.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
if (!existsSync(join(distDir, 'manifest.json'))) throw new Error('dist/manifest.json missing; run `npm run build` first')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
const archive = join(root, `adblocker-extension-${version}.zip`)
rmSync(archive, { force: true })
execFileSync('zip', ['-r', '-q', archive, '.'], { cwd: distDir, stdio: 'inherit' })
console.log(`wrote ${archive}`)
