import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
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

function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'buffer' })

  if (result.error || result.status !== 0) {
    throw result.error || new Error(`git ${args.join(' ')} exited with status ${result.status}`)
  }

  return result.stdout
}

function gitPaths(args) {
  return gitOutput(args)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

function normalizedPath(path) {
  return path.replaceAll('\\', '/')
}

function repoPath(path) {
  return normalizedPath(isAbsolute(path) ? relative(process.cwd(), path) : path)
}

function validGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value) && !/^0+$/i.test(value)
}

function existingCommit(sha) {
  if (!validGitSha(sha)) return null
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], {
    encoding: 'utf8',
  })
  return result.status === 0 ? result.stdout.trim() : null
}

function ruffBaseline() {
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  if (process.env.CI_BASE_SHA) {
    const pullRequestBase = existingCommit(process.env.CI_BASE_SHA)
    if (pullRequestBase) {
      const result = spawnSync('git', ['merge-base', 'HEAD', pullRequestBase], { encoding: 'utf8' })
      if (result.status === 0) return result.stdout.trim()
    }
    return process.env.GITHUB_ACTIONS === 'true' ? emptyTree : 'HEAD'
  }

  const pushBase = existingCommit(process.env.CI_BEFORE_SHA)
  if (pushBase) return pushBase

  return process.env.GITHUB_ACTIONS === 'true' ? emptyTree : 'HEAD'
}

function changedApiPythonFiles(base) {
  const paths = new Set(gitPaths(['diff', '--name-only', '-z', base]))
  const untracked = gitPaths(['ls-files', '--others', '--exclude-standard', '-z'])
  for (const path of untracked) paths.add(path)

  return [...paths]
    .map(normalizedPath)
    .filter(path => path.startsWith('apps/api/') && path.endsWith('.py') && existsSync(path))
    .sort()
}

function changedLines(base, files) {
  const linesByFile = new Map()
  for (const file of files) {
    const ranges = []
    if (gitPaths(['ls-files', '--others', '--exclude-standard', '-z']).includes(file)) {
      const lineCount = readFileSync(file, 'utf8').split(/\r?\n/).length
      if (lineCount > 0) ranges.push([1, lineCount])
    } else {
      const diff = gitOutput(['diff', '--no-ext-diff', '--no-color', '--unified=0', base, '--', file]).toString('utf8')
      for (const line of diff.split(/\r?\n/)) {
        const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (!match) continue
        const start = Number(match[1])
        const count = match[2] === undefined ? 1 : Number(match[2])
        if (count > 0) ranges.push([start, start + count - 1])
      }
    }
    linesByFile.set(file, ranges)
  }
  return linesByFile
}

function intersectsChangedLines(ranges, changed) {
  return ranges.some(([start, end]) => changed.some(([first, last]) => start <= last && end >= first))
}

function diagnosticRanges(diagnostic) {
  const ranges = []
  const addRange = range => {
    if (!range?.location?.row) return
    ranges.push([range.location.row, range.end_location?.row ?? range.location.row])
  }
  addRange(diagnostic)
  for (const edit of diagnostic.fix?.edits ?? []) addRange(edit)
  return ranges
}

function formatRuffDiagnostic(diagnostic) {
  const { filename, location, code, message } = diagnostic
  return `${filename}:${location.row}:${location.column}: ${code} ${message}`
}

function ruffDiagnostics(files, config) {
  const result = spawnSync(
    pythonCommand,
    ['-m', 'ruff', 'check', '--config', config, '--output-format', 'json', ...files],
    {
      encoding: 'utf8',
      shell: isWindows && /\.(cmd|bat)$/i.test(pythonCommand),
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `Ruff exited with status ${result.status}`)
  }
  return JSON.parse(result.stdout || '[]')
}

function diagnosticSignature(path, diagnostic) {
  return `${path}\0${diagnostic.code}\0${diagnostic.message}`
}

function baselineRuffSignatures(base, files) {
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  if (base === emptyTree) return new Map()

  const tempDirectory = mkdtempSync(join(tmpdir(), 'ci-gate-ruff-'))
  try {
    const baselineFiles = []
    for (const file of files) {
      const result = spawnSync('git', ['show', `${base}:${file}`], { encoding: 'buffer' })
      if (result.status !== 0) continue
      const tempFile = join(tempDirectory, file)
      mkdirSync(dirname(tempFile), { recursive: true })
      writeFileSync(tempFile, result.stdout)
      baselineFiles.push(tempFile)
    }
    if (baselineFiles.length === 0) return new Map()

    const signatures = new Map()
    for (const diagnostic of ruffDiagnostics(baselineFiles, join(process.cwd(), 'apps/api/pyproject.toml'))) {
      const path = normalizedPath(relative(tempDirectory, diagnostic.filename))
      const signature = diagnosticSignature(path, diagnostic)
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1)
    }
    return signatures
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

function runChangedApiRuff() {
  startStep('Backend Ruff (changed lines)')

  try {
    const base = ruffBaseline()
    const files = changedApiPythonFiles(base)
    if (files.length === 0) {
      console.log('No changed API Python files to lint')
      finishStep('ok')
      return
    }

    const linesByFile = changedLines(base, files)
    const baseline = baselineRuffSignatures(base, files)
    const diagnostics = ruffDiagnostics(files, join(process.cwd(), 'apps/api/pyproject.toml'))
    const changedDiagnostics = diagnostics.filter(diagnostic => {
      const changed = linesByFile.get(repoPath(diagnostic.filename)) ?? []
      return intersectsChangedLines(diagnosticRanges(diagnostic), changed)
    })
    let baselineIgnored = 0
    const actionable = changedDiagnostics.filter(diagnostic => {
      const signature = diagnosticSignature(repoPath(diagnostic.filename), diagnostic)
      const count = baseline.get(signature) ?? 0
      if (count === 0) return true
      baseline.set(signature, count - 1)
      baselineIgnored += 1
      return false
    })
    console.log(`Ignored out-of-scope Ruff diagnostics: ${diagnostics.length - changedDiagnostics.length}`)
    console.log(`Ignored baseline Ruff diagnostics: ${baselineIgnored}`)

    if (actionable.length > 0) {
      console.error(`Actionable Ruff diagnostics: ${actionable.length}`)
      for (const diagnostic of actionable) console.error(formatRuffDiagnostic(diagnostic))
      throw new Error(`${actionable.length} Ruff diagnostic(s) intersect changed lines`)
    }

    finishStep('ok')
  } catch (error) {
    console.error(error)
    finishStep('failed')
    printSummary()
    process.exit(1)
  }
}

const generatedChangelogPath = 'apps/web/src/data/changelog.generated.ts'
const generatedChangelogBefore = readFileSync(generatedChangelogPath)

function checkGeneratedChangelog() {
  startStep('Frontend Changelog Check')

  if (!readFileSync(generatedChangelogPath).equals(generatedChangelogBefore)) {
    console.error('apps/web/src/data/changelog.generated.ts is out of date; run pnpm --filter frontend run sync:changelog and commit the result')
    finishStep('failed')
    printSummary()
    process.exit(1)
  }

  finishStep('ok')
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

if (process.env.CI_GATE_RUFF_ONLY === '1') {
  runChangedApiRuff()
  printSummary()
} else {
  runStep('Frontend Lint', pnpmCommand, ['--filter', 'frontend', 'lint'], frontendEnv)
  runStep('Frontend Typecheck', pnpmCommand, ['--filter', 'frontend', 'exec', 'tsc', '--noEmit'], frontendEnv)
  runStep('Frontend Changelog Generation', pnpmCommand, ['--filter', 'frontend', 'run', 'sync:changelog'], frontendEnv)
  checkGeneratedChangelog()
  runStep('Frontend Build', pnpmCommand, ['--filter', 'frontend', 'build'], frontendEnv)
  runStep(
    'Frontend Tests',
    pnpmCommand,
    ['--filter', 'frontend', 'test', '--', '--runInBand'],
    frontendEnv
  )
  runChangedApiRuff()
  runStep('Backend Compile Check', pythonCommand, ['-m', 'py_compile', 'apps/api/vnibb/api/main.py'])
  runStep('Backend Tests', pythonCommand, ['-m', 'pytest', 'apps/api/tests', '-v'], { PYTHONPATH: 'apps/api' })

  printSummary()
  console.log('All gates passed')
}
