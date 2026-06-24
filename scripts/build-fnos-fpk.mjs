#!/usr/bin/env node
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { arch as osArch, platform as osPlatform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const packageName = 'hermes-studio'
const targetOS = process.env.FNOS_TARGET_OS?.trim() || 'linux'
const targetArch = process.env.FNOS_TARGET_ARCH?.trim() || 'x64'
const fnpack = process.env.FNPACK_BIN?.trim() || 'fnpack'

const sourceDir = path.join(root, 'fnos', packageName)
const buildRoot = path.join(root, '.fnos-build')
const outputDir = path.join(root, 'dist', 'fnos')
const stageDir = path.join(buildRoot, packageName)
const outputFpk = path.join(outputDir, `${packageName}.fpk`)
const platformLabel = `${targetOS}-${targetArch}`

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase())
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    shell: false,
    env: options.env || process.env,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function ensureFile(file) {
  if (!existsSync(file)) {
    throw new Error(`Missing required file: ${path.relative(root, file)}`)
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    throw new Error(`Missing required directory: ${path.relative(root, dir)}`)
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

async function syncIcons() {
  const icon64 = path.join(root, 'packages', 'desktop', 'build', 'icons', '64x64.png')
  const icon256 = path.join(root, 'packages', 'desktop', 'build', 'icons', '256x256.png')

  for (const icon of [icon64, icon256]) ensureFile(icon)

  await copyFile(icon64, path.join(stageDir, 'ICON.PNG'))
  await copyFile(icon256, path.join(stageDir, 'ICON_256.PNG'))
  await mkdir(path.join(stageDir, 'app', 'ui', 'images'), { recursive: true })
  await copyFile(icon64, path.join(stageDir, 'app', 'ui', 'images', 'icon_64.png'))
  await copyFile(icon256, path.join(stageDir, 'app', 'ui', 'images', 'icon_256.png'))
}

async function makeCommandScriptsExecutable() {
  const cmdDir = path.join(stageDir, 'cmd')
  const entries = await readdir(cmdDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(entry => chmod(path.join(cmdDir, entry.name), 0o755)),
  )
}

async function buildWebUi() {
  if (isTruthy(process.env.FNOS_SKIP_WEB_BUILD)) return
  run('npm', ['run', 'build'], {
    env: {
      ...process.env,
      VITE_HERMES_DISABLE_VERSION_PREVIEW: '1',
    },
  })
}

async function copyServer() {
  const serverDir = path.join(stageDir, 'app', 'server')
  const distDir = path.join(serverDir, 'dist')
  await rm(serverDir, { recursive: true, force: true })
  await mkdir(serverDir, { recursive: true })
  await mkdir(distDir, { recursive: true })

  ensureDir(path.join(root, 'dist'))
  ensureDir(path.join(root, 'dist', 'client'))
  ensureFile(path.join(root, 'dist', 'server', 'index.js'))

  await copyFile(path.join(root, 'package.json'), path.join(serverDir, 'package.json'))
  await copyFile(path.join(root, 'package-lock.json'), path.join(serverDir, 'package-lock.json'))
  await cp(path.join(root, 'bin'), path.join(serverDir, 'bin'), { recursive: true })
  for (const entry of ['client', 'server', 'skills', 'mcu']) {
    const source = path.join(root, 'dist', entry)
    if (existsSync(source)) {
      await cp(source, path.join(distDir, entry), { recursive: true })
    }
  }

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: serverDir })
  run('npm', ['rebuild', 'node-pty'], { cwd: serverDir })
}

async function copyRuntime() {
  const runtimeDir = path.join(stageDir, 'app', 'runtime')
  const nodeDir = path.join(root, 'packages', 'desktop', 'resources', 'node', platformLabel)
  const pythonDir = path.join(root, 'packages', 'desktop', 'resources', 'python', platformLabel)

  ensureFile(path.join(nodeDir, 'bin', 'node'))
  ensureFile(path.join(pythonDir, 'bin', 'python3'))
  ensureFile(path.join(pythonDir, 'bin', 'hermes'))
  ensureFile(path.join(pythonDir, 'run_agent.py'))

  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(runtimeDir, { recursive: true })
  await cp(nodeDir, path.join(runtimeDir, 'node'), { recursive: true, verbatimSymlinks: true })
  await cp(pythonDir, path.join(runtimeDir, 'python'), { recursive: true, verbatimSymlinks: false })

  const stagePythonBin = path.join(runtimeDir, 'python', 'bin')
  await materializeSymlinkedPythonBinary(stagePythonBin, 'python3', 'python3.12')
  await materializeSymlinkedPythonBinary(stagePythonBin, 'python', 'python3.12')

  const runtimeNode = path.join(runtimeDir, 'node', 'bin', 'node')
  const runtimePython = path.join(runtimeDir, 'python', 'bin', 'python3')
  const runtimeHermes = path.join(runtimeDir, 'python', 'bin', 'hermes')
  const runtimePythonAlt = path.join(runtimeDir, 'python', 'bin', 'python')

  await Promise.all([runFile(runtimeNode), runFile(runtimePython), runFile(runtimeHermes), runFile(runtimePythonAlt)])
}

async function materializeSymlinkedPythonBinary(dir, binaryName, targetName) {
  const binaryPath = path.join(dir, binaryName)
  if (!existsSync(binaryPath)) return

  let st
  try {
    st = await lstat(binaryPath)
  } catch {
    return
  }

  if (st.isSymbolicLink()) {
    const targetPath = path.resolve(dir, targetName)
    await rm(binaryPath, { force: true })
    await cp(targetPath, binaryPath, { force: true })
  }
}

async function runFile(binaryPath) {
  if (await fileExists(binaryPath)) {
    await run('chmod', ['+x', binaryPath])
  }
}

async function fileExists(filePath) {
  return existsSync(filePath)
}

if (targetOS !== osPlatform() || targetArch !== osArch()) {
  if (!isTruthy(process.env.FNOS_ALLOW_CROSS_NATIVE)) {
    throw new Error(
      `Native fnOS packages must be built on ${platformLabel}; current host is ${osPlatform()}-${osArch()}. `
      + 'Use the GitHub Actions workflow or set FNOS_ALLOW_CROSS_NATIVE=1 only for structural packaging tests.',
    )
  }
}

await rm(buildRoot, { recursive: true, force: true })
await rm(outputFpk, { force: true })
await mkdir(buildRoot, { recursive: true })
await mkdir(outputDir, { recursive: true })
await cp(sourceDir, stageDir, { recursive: true })
await rm(path.join(stageDir, 'app', 'docker'), { recursive: true, force: true })

await buildWebUi()
await makeCommandScriptsExecutable()
await syncIcons()
await writePatchedManifest()
await copyServer()
await copyRuntime()

run(fnpack, ['build', '--directory', stageDir], { cwd: outputDir })

if (!existsSync(outputFpk)) {
  throw new Error(`fnpack did not create ${path.relative(root, outputFpk)}`)
}

console.log(`fnOS native package: ${path.relative(root, outputFpk)}`)
console.log(`fnOS native target: ${platformLabel}`)
