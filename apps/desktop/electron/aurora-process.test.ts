import { describe, expect, it } from 'vitest'

import { commandLineIsAuroraRuntime } from './aurora-process'

// HX003: process identity comes from a whole argv TOKEN, never an argv substring.
describe('commandLineIsAuroraRuntime (HX003 token matching)', () => {
  it('matches a real Aurora gateway command line', () => {
    expect(commandLineIsAuroraRuntime('aurora\0gateway\0run')).toBe(true)
    expect(commandLineIsAuroraRuntime('aurora gateway run')).toBe(true)
    expect(commandLineIsAuroraRuntime('aurora --profile work gateway run')).toBe(true)
  })

  it('matches an Aurora launched by an interpreter (basename of a path token)', () => {
    expect(commandLineIsAuroraRuntime('/venv/bin/python\0/venv/bin/aurora\0gateway\0run')).toBe(true)
    expect(commandLineIsAuroraRuntime('C:\\Aurora\\aurora.exe gateway run')).toBe(true)
  })

  // The bug this replaces: a bare `.includes('aurora')` matched any of these.
  it('does NOT match an unrelated process whose path merely contains "aurora"', () => {
    expect(commandLineIsAuroraRuntime('vim /home/user/aurora-notes.txt')).toBe(false)
    expect(commandLineIsAuroraRuntime('/opt/aurorabrew/bin/tool --run')).toBe(false)
    expect(commandLineIsAuroraRuntime('node /srv/aurora-dashboard/server.js')).toBe(false)
    expect(commandLineIsAuroraRuntime('cat ~/.aurora/config.yaml')).toBe(false)
  })

  // G2 (#150283): the real unmanaged-gateway launch is `python -m aurora_cli.main … gateway
  // run`, which the executable-basename-only matcher REJECTED — so findRunningGatewayProfiles
  // missed a live gateway at first launch / profile repair. Mirror the canonical Python matcher
  // (gateway.status.looks_like_gateway_command_line): recognize the module entry point, by argv
  // TOKENS not a substring, carrying the gateway subcommand.
  it('matches a module-launched gateway (python -m aurora_cli.main … gateway run)', () => {
    expect(commandLineIsAuroraRuntime('python\0-m\0aurora_cli.main\0-p\0x\0gateway\0run')).toBe(true)
    expect(commandLineIsAuroraRuntime('python -m aurora_cli.main -p x gateway run')).toBe(true)
    expect(commandLineIsAuroraRuntime('/venv/bin/python /venv/lib/aurora_cli/main.py gateway run')).toBe(true)
    expect(commandLineIsAuroraRuntime('python -m aurora_cli.main --profile work gateway run')).toBe(true)
  })

  it('does NOT match a module entry without the gateway subcommand, nor an unrelated aurora-tool path', () => {
    // An aurora_cli.main invocation that is not a gateway (e.g. `chat`) is not a running gateway.
    expect(commandLineIsAuroraRuntime('python -m aurora_cli.main chat')).toBe(false)
    // HX003: no substring; an unrelated tool whose path contains "aurora" is never a runtime.
    expect(commandLineIsAuroraRuntime('/opt/aurora-tool/foo gateway run')).toBe(false)
    // `-p gateway` is a profile value, not a subcommand.
    expect(commandLineIsAuroraRuntime('python -m aurora_cli.main -p gateway chat')).toBe(false)
  })
})
