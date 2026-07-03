import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'

const frontendEnv = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  NEXT_PUBLIC_WS_URL:
    process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/api/v1/ws/prices',
}

const steps = []
let currentStep = null

function startStep(label) {
  currentStep = { label, status: 'running', startedAt: Date.now() }
  steps.push(currentStep)
  console.log(`=== ${label} ===`)
}

function finishStep(status) {
  if (!currentStep) return
  currentStep.status = status
  currentStep.durationMs = Date.now() - currentStep.startedAt
  currentStep = null
}

function runStep(label, command, args = [], extraEnv = {}) {
  startStep(label)

  const env = {
    ...process.env,
    ...extraEnv,
  }
  const shouldUseCmd = isWindows && /\.cmd$/i.test(command)
  const result = shouldUseCmd
    ? spawnSync(command, args, {
        stdio: 'inherit',
        env,
        shell: true,
      })
    : spawnSync(command, args, {
        stdio: 'inherit',
        env,
      })

  if (result.error) {
    console.error(result.error)
    finishStep('error')
    printSummary()
    process.exit(1)
  }

  if (result.status !== 0) {
    finishStep('failed')
    printSummary()
    process.exit(result.status ?? 1)
  }

  finishStep('ok')
}

function printSummary() {
  console.log('\n=== CI Gate Summary ===')
  if (steps.length === 0) {
    console.log('  (no steps ran)')
    return
  }
  const totalMs = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
  for (const step of steps) {
    const dur = step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : '-'
    const statusLabel = step.status.padEnd(7)
    console.log(`  ${statusLabel} ${dur.padStart(7)}  ${step.label}`)
  }
  console.log(`  Total: ${(totalMs / 1000).toFixed(1)}s across ${steps.length} step(s)`)
}

function resolvePnpmCommand() {
  if (process.env.PNPM_BIN && existsSync(process.env.PNPM_BIN)) {
    return process.env.PNPM_BIN
  }

  const preferredCandidates = [
    process.env.APPDATA && join(process.env.APPDATA, 'npm', isWindows ? 'pnpm.cmd' : 'pnpm'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm', isWindows ? 'pnpm.exe' : 'pnpm'),
  ].filter(Boolean)

  for (const candidate of preferredCandidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  const npmPrefix = spawnSync(npmCommand, ['config', 'get', 'prefix'], {
    encoding: 'utf8',
  })

  if (npmPrefix.status === 0) {
    const prefix = npmPrefix.stdout.trim()
    if (prefix) {
      const candidate = join(prefix, isWindows ? 'pnpm.cmd' : 'pnpm')
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  if (isWindows) {
    const whereResult = spawnSync('where.exe', ['pnpm'], {
      encoding: 'utf8',
    })

    if (whereResult.status === 0) {
      const matches = whereResult.stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/\\Program Files\\nodejs\\pnpm(\.cmd|\.ps1)?$/i.test(line))

      if (matches.length > 0) {
        return matches[0]
      }
    }
  }

  return isWindows ? 'pnpm.cmd' : 'pnpm'
}

function supportsPytest(command) {
  const probe = spawnSync(command, ['-c', 'import pytest'], {
    stdio: 'ignore',
    shell: isWindows && /\.(cmd|bat)$/i.test(command),
  })

  return probe.status === 0
}

function resolvePythonCommand() {
  const candidates = [
    process.env.PYTHON,
    process.env.PYTHON_BIN,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Python', 'bin', 'python.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe'),
    'python',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.includes('python') && supportsPytest(candidate)) {
      return candidate
    }
  }

  return process.env.PYTHON || 'python'
}

const pnpmCommand = resolvePnpmCommand()
const pythonCommand = resolvePythonCommand()

process.on('SIGINT', () => {
  finishStep('interrupted')
  printSummary()
  console.error('Interrupted by SIGINT')
  process.exit(130)
})
process.on('SIGTERM', () => {
  finishStep('terminated')
  printSummary()
  console.error('Terminated by SIGTERM')
  process.exit(143)
})

runStep('Frontend Lint', pnpmCommand, ['--filter', 'frontend', 'lint'], frontendEnv)
runStep('Frontend Typecheck', pnpmCommand, ['--filter', 'frontend', 'exec', 'tsc', '--noEmit'], frontendEnv)
runStep('Frontend Build', pnpmCommand, ['--filter', 'frontend', 'build'], frontendEnv)
runStep(
  'Frontend Tests',
  pnpmCommand,
  ['--filter', 'frontend', 'test', '--', '--runInBand'],
  frontendEnv
)
runStep('Backend Compile Check', pythonCommand, ['-m', 'py_compile', 'apps/api/vnibb/api/main.py'])
runStep('Backend Tests', pythonCommand, ['-m', 'pytest', 'apps/api/tests', '-v'])

printSummary()
console.log('All gates passed')
