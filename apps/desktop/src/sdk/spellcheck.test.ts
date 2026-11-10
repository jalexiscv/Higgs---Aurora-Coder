import { afterEach, describe, expect, it, vi } from 'vitest'

import { host } from '@/sdk'

const desktopWindow = window as unknown as { auroraDesktop?: Partial<Window['auroraDesktop']> }

afterEach(() => {
  delete desktopWindow.auroraDesktop
})

describe('host.spellcheck dictionary verbs', () => {
  it("routes one word through the app's dictionary IPC and reports main's verdict", async () => {
    const spellcheckDictionary = vi.fn(async () => true)

    desktopWindow.auroraDesktop = { spellcheckDictionary }

    expect(await host.spellcheck.addWord('Aurora')).toBe(true)
    expect(await host.spellcheck.removeWord('Aurora')).toBe(true)

    expect(spellcheckDictionary.mock.calls).toEqual([
      ['add', 'Aurora'],
      ['remove', 'Aurora']
    ])

    spellcheckDictionary.mockResolvedValueOnce(false)

    expect(await host.spellcheck.addWord('two words')).toBe(false)
  })

  it('resolves false instead of throwing without a desktop shell or with a non-string', async () => {
    expect(await host.spellcheck.addWord('Aurora')).toBe(false)

    const spellcheckDictionary = vi.fn(async () => {
      throw new Error('older shell')
    })

    desktopWindow.auroraDesktop = { spellcheckDictionary }

    expect(await host.spellcheck.removeWord('Aurora')).toBe(false)
    expect(await host.spellcheck.addWord(42 as unknown as string)).toBe(false)
    expect(spellcheckDictionary).toHaveBeenCalledTimes(1)
  })
})
