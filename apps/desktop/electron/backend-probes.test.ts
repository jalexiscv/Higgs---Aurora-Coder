/**
 * Tests for electron/backend-probes.ts.
 *
 * Run with: node --test electron/backend-probes.test.ts
 * (Wired into pnpm run test:desktop:platforms in package.json.)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  canImportAuroraCli,
  DEFAULT_PROBE_TIMEOUT_MS,
  execProbe,
  PROBE_TIMEOUT_MS,
  resolveProbeTimeoutMs,
  shouldTrustAuroraOverride,
  verifyAuroraCli
} from './backend-probes'

// Resolve the host's own Node binary -- guaranteed to be on disk and
// runnable. We use it as both a stand-in for "a python that doesn't
// have aurora_cli" (since `node -c "import aurora_cli"` will exit
// non-zero) and as a way to script verifyAuroraCli's success path
// (a tiny script we write to disk that exits 0 on --version).
const NODE_BIN = process.execPath

test('execProbe keeps the parent event loop available to the child', async () => {
  let unexpectedSocketError: Error | undefined

  const server = net.createServer(socket => {
    socket.on('error', error => {
      // A successful child exits immediately after reading the sentinel. On
      // Windows that peer close can surface as ECONNRESET on the server side.
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
        unexpectedSocketError ??= error
      }
    })
    socket.end('pong')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const childScript = `
    const net = require('node:net')
    let reply = ''
    const socket = net.createConnection(${address.port}, '127.0.0.1')
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { reply += chunk })
    socket.on('end', () => process.exit(reply === 'pong' ? 0 : 1))
    socket.on('error', () => process.exit(1))
  `

  try {
    await execProbe(NODE_BIN, ['-e', childScript], {
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    })
  }

  assert.ifError(unexpectedSocketError)
})

test('canImportAuroraCli returns false when path is falsy', async () => {
  assert.equal(await canImportAuroraCli(''), false)
  assert.equal(await canImportAuroraCli(null), false)
  assert.equal(await canImportAuroraCli(undefined), false)
})

test('canImportAuroraCli returns false when interpreter cannot run -c', async () => {
  // node IS an interpreter, but `node -c "import aurora_cli"` is a
  // SyntaxError -- different exit reason from a real Python's
  // ModuleNotFoundError, but the predicate is "exit 0 or not" and
  // both land on "not", which is exactly what we want for the
  // resolver fall-through.
  assert.equal(await canImportAuroraCli(NODE_BIN), false)
})

test('canImportAuroraCli returns false when binary does not exist', async () => {
  const ghost = path.join(os.tmpdir(), 'aurora-probes-ghost-' + Date.now() + '.exe')
  assert.equal(await canImportAuroraCli(ghost), false)
})

test('explicit Aurora override is authoritative', () => {
  assert.equal(shouldTrustAuroraOverride('/nix/store/abc/bin/aurora'), true)
})

test('empty Aurora override is not authoritative', () => {
  assert.equal(shouldTrustAuroraOverride(''), false)
  assert.equal(shouldTrustAuroraOverride(undefined), false)
})

test('verifyAuroraCli returns false when command is falsy', async () => {
  assert.equal(await verifyAuroraCli(''), false)
  assert.equal(await verifyAuroraCli(null), false)
  assert.equal(await verifyAuroraCli(undefined), false)
})

test('verifyAuroraCli returns false when binary does not exist', async () => {
  const ghost = path.join(os.tmpdir(), 'aurora-probes-ghost-' + Date.now() + '.exe')
  assert.equal(await verifyAuroraCli(ghost), false)
})

test('verifyAuroraCli accepts an actual zero-exit executable', async (): Promise<void> => {
  assert.equal(await verifyAuroraCli(NODE_BIN), true)
})

// #74064: with shell:true the command line goes through a shell (cmd.exe on
// Windows, /bin/sh here), which truncates an unquoted executable at the first
// space — `C:\Users\John Doe\...\aurora.cmd --version` runs `C:\Users\John`.
// The same truncation reproduces on POSIX sh, so this is a real behavioral
// test of the quoting, not a platform-conditional one. Windows gets its own
// lane: there the quoted form goes through cmd.exe /s semantics instead.
test.skipIf(process.platform === 'win32')(
  'verifyAuroraCli quotes a spaced executable path when probing through a shell',
  async (): Promise<void> => {
    const spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora probe-'))
    const spacedCmd = path.join(spacedDir, 'aurora.cmd')
    fs.writeFileSync(spacedCmd, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.chmodSync(spacedCmd, 0o755)

    try {
      // Unquoted (the pre-fix wiring): the shell truncates at the space → 127.
      await execProbe(spacedCmd, ['--version'], {
        stdio: 'ignore',
        timeout: 5_000,
        shell: true,
        windowsHide: true
      })
      assert.fail('unquoted spaced path must fail through the shell')
    } catch {
      // expected: the shell could not run the truncated command
    }

    // verifyAuroraCli wraps the same failure: off-Windows the helper is a
    // no-op (POSIX sh truncates identically), so the spaced-path probe
    // reports the backend missing — exactly the #74064 symptom. The quoting
    // itself is covered by the windowsShellCommand unit tests and runs on
    // the Windows lane.
    assert.equal(await verifyAuroraCli(spacedCmd, { shell: true }), false)

    // Direct execution (shell: false) never goes through a shell, so a
    // spaced path works as-is — the fix must not leak into the non-shell path.
    assert.equal(await verifyAuroraCli(spacedCmd, { shell: false }), true)

    fs.rmSync(spacedDir, { recursive: true, force: true })
  }
)

test('default probe timeout is 15s (not the old 5s death-loop value)', () => {
  assert.equal(DEFAULT_PROBE_TIMEOUT_MS, 15_000)
  // Module constant uses process.env at load time; with no override it
  // matches the default (tests run without AURORA_PROBE_TIMEOUT_MS).
  assert.equal(PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS)
})

test('resolveProbeTimeoutMs honours AURORA_PROBE_TIMEOUT_MS', () => {
  assert.equal(resolveProbeTimeoutMs({}), DEFAULT_PROBE_TIMEOUT_MS)
  assert.equal(resolveProbeTimeoutMs({ AURORA_PROBE_TIMEOUT_MS: '30000' }), 30_000)
  assert.equal(resolveProbeTimeoutMs({ AURORA_PROBE_TIMEOUT_MS: '0' }), DEFAULT_PROBE_TIMEOUT_MS)
  assert.equal(resolveProbeTimeoutMs({ AURORA_PROBE_TIMEOUT_MS: 'nope' }), DEFAULT_PROBE_TIMEOUT_MS)
  // Cap runaway values
  assert.equal(resolveProbeTimeoutMs({ AURORA_PROBE_TIMEOUT_MS: '999999' }), 120_000)
})
