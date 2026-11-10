import { describe, expect, it } from 'vitest'

import {
  normalizeAuroraOpenString,
  pathFromAuroraDeepLink,
  pathFromOpenDeepLink,
  resolveAuroraOpenPath
} from './aurora-open-target'

describe('normalizeAuroraOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeAuroraOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeAuroraOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped aurora:// deep links to the same path', () => {
    expect(normalizeAuroraOpenString('aurora://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeAuroraOpenString('aurora://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps aurora://open/… deep links by stripping the open host', () => {
    expect(normalizeAuroraOpenString('aurora://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeAuroraOpenString('aurora://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved aurora kinds and unsafe paths', () => {
    expect(normalizeAuroraOpenString('aurora://blueprint/morning-brief')).toBeNull()
    expect(normalizeAuroraOpenString('aurora://plugin/install')).toBeNull()
    expect(normalizeAuroraOpenString('https://example.com/x')).toBeNull()
    expect(normalizeAuroraOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeAuroraOpenString('index-network')).toBeNull()
  })
})

describe('resolveAuroraOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveAuroraOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveAuroraOpenPath({ href: 'aurora://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromAuroraDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromAuroraDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from aurora://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromAuroraDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromAuroraDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromAuroraDeepLink('plugin', 'install')).toBeNull()
  })
})
