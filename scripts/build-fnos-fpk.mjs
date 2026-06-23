#!/usr/bin/env node
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const packageName = 'hermes-studio'
const defaultImage = 'ghcr.io/mscorpiolee/hermes-studio:latest'
const image = process.env.FNOS_IMAGE?.trim() || defaultImage
const fnpack = process.env.FNPACK_BIN?.trim() || 'fnpack'

const sourceDir = path.join(root, 'fnos', packageName)
const outputDir = path.join(root, 'dist', 'fnos')
const stageDir = path.join(outputDir, packageName)
const outputFpk = path.join(outputDir, `${packageName}.fpk`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function replaceLine(text, key, value) {
  const pattern = new RegExp(`^(${key}\\s*=\\s*).*$`, 'm')
  if (!pattern.test(text)) {
    throw new Error(`Missing manifest key: ${key}`)
  }
  return text.replace(pattern, `$1${value}`)
}

async function writePatchedManifest() {
  const manifestPath = path.join(stageDir, 'manifest')
  let manifest = await readFile(manifestPath, 'utf8')
  manifest = replaceLine(manifest, 'version', packageJson.version)
  await writeFile(manifestPath, manifest)
}

async function writePatchedCompose() {
  const composePath = path.join(stageDir, 'app', 'docker', 'docker-compose.yaml')
  const compose = await readFile(composePath, 'utf8')
  const patched = compose.includes('__FNOS_IMAGE__')
    ? compose.replaceAll('__FNOS_IMAGE__', image)
    : compose.replace(/^(\s*image:\s*).+$/m, `$1${image}`)

  if (patched === compose && !compose.includes(image)) {
    throw new Error('fnOS compose template is missing an image field')
  }
  await writeFile(composePath, patched)
}

async function syncIcons() {
  const icon64 = path.join(root, 'packages', 'desktop', 'build', 'icons', '64x64.png')
  const icon256 = path.join(root, 'packages', 'desktop', 'build', 'icons', '256x256.png')

  for (const icon of [icon64, icon256]) {
    if (!existsSync(icon)) {
      throw new Error(`Missing icon source: ${path.relative(root, icon)}`)
    }
  }

  await copyFile(icon64, path.join(stageDir, 'ICON.PNG'))
  await copyFile(icon256, path.join(stageDir, 'ICON_256.PNG'))
  await mkdir(path.join(stageDir, 'app', 'ui', 'images'), { recursive: true })
  await copyFile(icon64, path.join(stageDir, 'app', 'ui', 'images', 'icon_64.png'))
  await copyFile(icon256, path.join(stageDir, 'app', 'ui', 'images', 'icon_256.png'))
}

await rm(stageDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
await cp(sourceDir, stageDir, { recursive: true })
await syncIcons()
await writePatchedManifest()
await writePatchedCompose()

await rm(outputFpk, { force: true })
run(fnpack, ['build', '--directory', stageDir], { cwd: outputDir })

const generatedFpk = path.join(outputDir, `${packageName}.fpk`)
if (!existsSync(generatedFpk)) {
  throw new Error(`fnpack did not create ${path.relative(root, generatedFpk)}`)
}

if (generatedFpk !== outputFpk) {
  await rename(generatedFpk, outputFpk)
}

console.log(`fnOS package: ${path.relative(root, outputFpk)}`)
console.log(`fnOS image: ${image}`)
