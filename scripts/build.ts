/**
 * Builds the extension into dist/:
 *  - bundles each TypeScript entry point with esbuild (IIFE, no runtime deps)
 *  - copies static assets (HTML, CSS, icons, rule JSON)
 *  - writes manifest.json, adding the optional EasyList ruleset when it has been generated
 *
 * Usage: node scripts/build.ts [--watch]
 */

import { build, context, type BuildOptions } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const distDir = join(root, 'dist')
const isWatch = process.argv.includes('--watch')

const ENTRY_POINTS: Record<string, string> = {
  'background/service-worker': 'src/background/service-worker.ts',
  'content/cosmetic/cosmetic': 'src/content/cosmetic/cosmetic.ts',
  'content/youtube/main-world': 'src/content/youtube/main-world.ts',
  'content/youtube/isolated': 'src/content/youtube/isolated.ts',
  'popup/popup': 'src/popup/popup.ts',
  'options/options': 'src/options/options.ts',
}

const STATIC_FILES = [
  'popup/popup.html',
  'popup/popup.css',
  'options/options.html',
  'options/options.css',
  'content/cosmetic/generic.css',
  'content/youtube/youtube.css',
]

const STATIC_DIRS = ['icons']

const RULE_FILES: Record<string, string> = {
  youtube: 'rules/youtube.json',
  ads_core: 'rules/ads-core.json',
  trackers: 'rules/trackers.json',
  streaming: 'rules/streaming.json',
}

const OPTIONAL_RULE_FILES: Record<string, string> = {
  easylist: 'rules/easylist.json',
}

const esbuildOptions: BuildOptions = {
  entryPoints: Object.fromEntries(
    Object.entries(ENTRY_POINTS).map(([name, file]) => [name, join(root, file)]),
  ),
  outdir: distDir,
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  platform: 'browser',
  sourcemap: isWatch ? 'inline' : false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
}

function copyStaticAssets(): void {
  for (const file of STATIC_FILES) {
    const source = join(srcDir, file)
    if (!existsSync(source)) throw new Error(`Missing static asset: ${file}`)
    const target = join(distDir, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
  }
  for (const dir of STATIC_DIRS) {
    cpSync(join(srcDir, dir), join(distDir, dir), { recursive: true })
  }
}

function copyRuleFile(relativePath: string): number {
  const rules = JSON.parse(readFileSync(join(srcDir, relativePath), 'utf8')) as unknown[]
  const target = join(distDir, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(rules))
  return rules.length
}

function writeManifest(): void {
  const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8')) as Record<string, unknown>
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  manifest.version = pkg.version

  const ruleResources: Array<{ id: string; enabled: boolean; path: string }> = []
  for (const [id, path] of Object.entries(RULE_FILES)) {
    const count = copyRuleFile(path)
    ruleResources.push({ id, enabled: true, path })
    console.log(`ruleset ${id}: ${count} rules`)
  }
  for (const [id, path] of Object.entries(OPTIONAL_RULE_FILES)) {
    if (!existsSync(join(srcDir, path))) continue
    const count = copyRuleFile(path)
    if (count === 0) continue
    ruleResources.push({ id, enabled: true, path })
    console.log(`ruleset ${id}: ${count} rules (optional)`)
  }
  manifest.declarative_net_request = { rule_resources: ruleResources }

  writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function buildStatic(): void {
  copyStaticAssets()
  writeManifest()
}

async function main(): Promise<void> {
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  buildStatic()

  if (!isWatch) {
    await build(esbuildOptions)
    console.log(`Built extension into ${relative(root, distDir)}/`)
    return
  }

  const ctx = await context(esbuildOptions)
  await ctx.watch()
  watch(srcDir, { recursive: true }, (_event, filename) => {
    if (!filename || /\.ts$/.test(filename)) return
    try {
      buildStatic()
      console.log(`static rebuild (${filename})`)
    } catch (error) {
      console.error(error)
    }
  })
  console.log('Watching for changes...')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
