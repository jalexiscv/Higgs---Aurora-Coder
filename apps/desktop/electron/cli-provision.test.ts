import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test, type TestContext } from 'vitest'

import { provisionCliLinks, removeBundleCliLinks } from './cli-provision'

function fixture(): { root: string; binDir: string; source: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-cli-links-'))
  const binDir = path.join(root, 'bin')
  const source = path.join(root, 'new', 'agent-payload', 'bin', 'aurora')

  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.mkdirSync(binDir)
  fs.writeFileSync(source, 'payload command\n')

  return { root, binDir, source }
}

test.runIf(process.platform !== 'win32')(
  'retiring a bundle removes only its direct CLI links, including dangling ones',
  (): void => {
    const { root, binDir, source }: ReturnType<typeof fixture> = fixture()
    const payload: string = path.dirname(path.dirname(source))
    const target: string = path.join(binDir, 'aurora')

    try {
      provisionCliLinks({ aurora: source }, binDir, (): void => {})
      fs.symlinkSync(path.join(root, 'other/agent-payload/bin/other'), path.join(binDir, 'other'))
      fs.symlinkSync(source, path.join(binDir, 'personal-alias'))
      fs.writeFileSync(path.join(binDir, 'custom'), 'keep')
      fs.rmSync(source)
      removeBundleCliLinks(payload, binDir)
      assert.equal(fs.lstatSync(target, { throwIfNoEntry: false }), undefined)
      assert.deepEqual(fs.readdirSync(binDir).sort(), ['custom', 'other', 'personal-alias'])
      removeBundleCliLinks(payload, binDir)
      assert.equal(fs.readFileSync(path.join(binDir, 'custom'), 'utf8'), 'keep')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

test('repairs owned dangling CLI links without changing foreign or live entries', context => {
  const { root, binDir, source } = fixture()
  const messages: string[] = []
  const target = path.join(binDir, 'aurora')

  try {
    const oldSource = path.join(root, 'old', 'agent-payload', 'bin', 'aurora')

    try {
      fs.symlinkSync(oldSource, target)
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Windows symlinks require Developer Mode or elevation')
      }

      throw error
    }

    provisionCliLinks({ aurora: source }, binDir, message => messages.push(message))
    assert.equal(fs.readlinkSync(target), source)
    assert.equal(fs.readFileSync(source, 'utf8'), 'payload command\n')
    assert.deepEqual(fs.readdirSync(binDir), ['aurora'])

    const foreign = path.join(root, 'removed-other-tool', 'aurora')
    const otherName = path.join(root, 'old', 'agent-payload', 'bin', 'other')

    for (const destination of [source, foreign, otherName, 'agent-payload/bin/aurora']) {
      fs.unlinkSync(target)
      fs.symlinkSync(destination, target)
      const original = fs.readlinkSync(target)

      provisionCliLinks({ aurora: source }, binDir, message => messages.push(message))
      assert.equal(fs.readlinkSync(target), original)
      assert.deepEqual(fs.readdirSync(binDir), ['aurora'])
    }

    fs.unlinkSync(target)
    fs.writeFileSync(target, 'user command\n')
    provisionCliLinks({ aurora: source }, binDir, message => messages.push(message))
    assert.equal(fs.readFileSync(target, 'utf8'), 'user command\n')
    fs.unlinkSync(target)
    provisionCliLinks({ aurora: source }, binDir, message => messages.push(message))
    assert.equal(fs.readlinkSync(target), source)
    assert.equal(messages.filter(message => message.includes('linked 1')).length, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('qualified CLI paths expose their filenames, not shared canonical command keys', (context: TestContext): void => {
  const { root, binDir, source }: ReturnType<typeof fixture> = fixture()

  try {
    const plain: string = path.join(binDir, 'aurora')
    fs.writeFileSync(plain, 'stable command')

    try {
      fs.symlinkSync(source, path.join(binDir, 'probe'))
      fs.unlinkSync(path.join(binDir, 'probe'))
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Windows symlinks require Developer Mode or elevation')
      }

      throw error
    }

    for (const name of ['aurora-canary', 'aurora-abcdef1', 'aurora-1234567']) {
      const cli: string = path.join(path.dirname(source), name)
      const acp: string = `${cli}-acp`
      fs.writeFileSync(cli, name)
      fs.writeFileSync(acp, `${name}-acp`)
      provisionCliLinks({ aurora: cli, 'aurora-acp': acp }, binDir, (): void => {})
      assert.equal(fs.readlinkSync(path.join(binDir, name)), cli)
      assert.equal(fs.readlinkSync(path.join(binDir, `${name}-acp`)), acp)
    }

    assert.equal(fs.readFileSync(plain, 'utf8'), 'stable command')
    assert.equal(fs.existsSync(path.join(binDir, 'aurora-acp')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a failed link swap preserves its source and target, then provisions later commands', context => {
  const { root, binDir, source } = fixture()
  const target = path.join(binDir, 'aurora')
  const oldSource = path.join(root, 'old', 'agent-payload', 'bin', 'aurora')
  const acpSource = path.join(path.dirname(source), 'aurora-acp')
  const messages: string[] = []
  let swaps = 0

  try {
    try {
      fs.symlinkSync(oldSource, target)
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Windows symlinks require Developer Mode or elevation')
      }

      throw error
    }

    fs.writeFileSync(acpSource, 'ACP command\n')
    provisionCliLinks({ aurora: source, 'aurora-acp': acpSource }, binDir, message => messages.push(message), {
      ...fs,
      renameSync: (from, to) => {
        swaps += 1
        fs.unlinkSync(from)
        fs.renameSync(from, to)
      }
    })

    assert.equal(swaps, 1)
    assert.equal(fs.readlinkSync(target), oldSource)
    assert.equal(fs.readFileSync(source, 'utf8'), 'payload command\n')
    assert.equal(fs.readlinkSync(path.join(binDir, 'aurora-acp')), acpSource)
    assert.deepEqual(fs.readdirSync(binDir).sort(), ['aurora', 'aurora-acp'])
    assert.ok(messages.some(message => message.includes('aurora') && message.includes('ENOENT')))
    assert.ok(messages.some(message => message.includes('linked 1')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
