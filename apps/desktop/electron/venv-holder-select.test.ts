import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isAuroraOwnedVenvDaemon, isExternalVenvHolder } from './venv-holder-select'

const SCRIPTS = 'C:\\Aurora\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isAuroraOwnedVenvDaemon(
      'C:\\Aurora\\venv\\Scripts\\pythonw.exe',
      'C:\\Aurora\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isAuroraOwnedVenvDaemon(
      'c:\\aurora\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Aurora\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the aurora CLI from the venv — must NOT be killed
  assert.equal(isAuroraOwnedVenvDaemon('C:\\Aurora\\venv\\Scripts\\aurora.exe', 'aurora chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isAuroraOwnedVenvDaemon('C:\\Aurora\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isAuroraOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Aurora\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Aurora\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isAuroraOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isAuroraOwnedVenvDaemon('C:\\Aurora\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isAuroraOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})

// --- isExternalVenvHolder (#62311) ------------------------------------------

test('matches the autostart gateway shim (aurora.exe under venv Scripts)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Aurora\\venv\\Scripts\\aurora.exe',
      '"C:\\Aurora\\venv\\Scripts\\aurora.exe" gateway run --external-supervisor',
      SCRIPTS
    ),
    true
  )
})

test('matches the dashboard scheduled task (python -m aurora_cli / -m aurora)', () => {
  assert.equal(
    isExternalVenvHolder(
      'C:\\Aurora\\venv\\Scripts\\python.exe',
      '"C:\\Aurora\\venv\\Scripts\\python.exe" -m aurora_cli.main dashboard',
      SCRIPTS
    ),
    true
  )
  assert.equal(
    isExternalVenvHolder('C:\\Aurora\\venv\\Scripts\\pythonw.exe', 'pythonw.exe -m aurora serve', SCRIPTS),
    true
  )
})

test('never matches an unrelated process that merely borrows the venv interpreter', () => {
  // a user's own script running on the venv python — NOT Aurora, must NOT be killed
  assert.equal(
    isExternalVenvHolder('C:\\Aurora\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
  // hindsight daemon is selected by isAuroraOwnedVenvDaemon, not here
  assert.equal(
    isExternalVenvHolder('C:\\Aurora\\venv\\Scripts\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('never matches a process outside the venv, even with aurora in the cmdline', () => {
  // an editor / shell whose command line mentions the install root (#62445 regression guard)
  assert.equal(
    isExternalVenvHolder('C:\\Windows\\System32\\cmd.exe', 'cmd /c cd C:\\Aurora\\venv\\Scripts && dir', SCRIPTS),
    false
  )
  assert.equal(isExternalVenvHolder('C:\\Other\\aurora.exe', 'aurora gateway run', SCRIPTS), false)
})

test('sibling-dir and boundary safety for the external selector', () => {
  assert.equal(isExternalVenvHolder('C:\\Aurora\\venv\\ScriptsX\\aurora.exe', 'aurora gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder(null, 'aurora gateway run', SCRIPTS), false)
  assert.equal(isExternalVenvHolder('C:\\Aurora\\venv\\Scripts\\aurora.exe', null, SCRIPTS), false)
})
