/**
 * @aurora belongs to the default bot only while its source has no real
 * (pre-reservation) `aurora` profile. With one, the roster shows exactly one
 * @aurora — the real profile — and the default answers to @default, so a
 * typed @aurora reaches the same profile the backend's message_agent does.
 */

import { describe, expect, it, vi } from 'vitest'

import { botHandle, botMentionTag, claimDefaultHandles, mergeMultiSourceRoster, resolveRosterMentions } from './data'
import { previewKind } from './row-helpers'
import type { RosterRow } from './types'

vi.mock('@aurora/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return { atom, host: {}, queryClient: undefined, useQuery: vi.fn(), useValue: vi.fn() }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'aurora-bots' }))

function roster(names: string[]): RosterRow[] {
  const local = { profiles: names.map(name => ({ name })) }

  // What Electron's buildAgentRoster reports for a single local source: bare-name handles.
  const union = {
    agents: names.map(profile => ({
      connectionId: 'local',
      connectionKind: 'local' as const,
      connectionLabel: 'This device',
      handle: profile,
      profile,
      targetProfile: profile
    })),
    primaryConnectionId: 'local'
  }

  return mergeMultiSourceRoster(local, union, 'local').profiles as RosterRow[]
}

describe('the @aurora handle', () => {
  it.each([
    [['default', 'researcher'], 'default'],
    [['default', 'aurora', 'researcher'], 'aurora']
  ])('roster %j shows one @aurora and a typed @aurora reaches %s', (names, owner) => {
    const rows = roster(names)
    const handles = rows.map(row => botHandle(row.name, row))

    expect(handles.filter(handle => handle === 'aurora')).toHaveLength(1)
    expect(rows.map(row => botMentionTag(row)).filter(tag => tag === 'aurora')).toHaveLength(1)
    expect(resolveRosterMentions('@aurora ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual([owner])
  })

  it('names the default @default once a real aurora profile holds the handle', () => {
    const rows = roster(['default', 'aurora', 'researcher'])
    const byName = Object.fromEntries(rows.map(row => [row.name, botHandle(row.name, row)]))

    expect(byName).toEqual({ default: 'default', aurora: 'aurora', researcher: 'researcher' })
    expect(resolveRosterMentions('@default ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual(['default'])
  })

  it('keeps each source separate: a remote aurora profile does not rename the local default', () => {
    const rows = claimDefaultHandles<Partial<RosterRow>>([
      { connectionId: 'local', name: 'default' },
      { connectionId: 'mini', name: 'default' },
      { connectionId: 'mini', name: 'aurora' }
    ])

    expect(rows.map(row => botHandle(String(row.name), row))).toEqual(['aurora', 'default', 'aurora'])
  })

  it("never lets a source's stale 'aurora' handle on its default answer @aurora", () => {
    // An older backend labels its default @aurora even beside a real aurora profile.
    const rows = claimDefaultHandles<RosterRow>([
      { connectionId: 'mini', handle: 'aurora', name: 'default', remoteSource: true },
      { connectionId: 'mini', handle: 'aurora', name: 'aurora', remoteSource: true },
      { connectionId: 'local', name: 'researcher' }
    ])

    expect(resolveRosterMentions('@aurora ping', rows, { name: 'researcher' }).map(row => row.name)).toEqual(['aurora'])
  })

  it('names a DM sender in a row preview by its roster handle', () => {
    const rows = claimDefaultHandles<RosterRow>(
      ['default', 'aurora', 'researcher'].map(name => ({ connectionId: 'local', name }))
    )

    const sender = (name: string, list: RosterRow[]) =>
      previewKind(`Message from 🤖 ${name} (@x): hi`, list, 'local').fromBot

    expect([sender('default', rows), sender('aurora', rows)]).toEqual(['default', 'aurora'])
    // No real aurora profile: the default is still @aurora (#89484).
    expect(sender('default', claimDefaultHandles<RosterRow>([{ connectionId: 'local', name: 'default' }]))).toBe(
      'aurora'
    )
  })
})
