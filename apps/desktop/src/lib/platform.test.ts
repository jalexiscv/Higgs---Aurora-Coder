// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { isBrowserHostedDesktop } from './platform'

type HostWindow = Window & {
  __AURORA_AUTH_REQUIRED__?: boolean
  __AURORA_SESSION_TOKEN__?: string
  __AURORA_UI_SURFACE__?: string
}

describe('isBrowserHostedDesktop', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-aurora-desktop-host')
    const win = window as HostWindow
    delete win.__AURORA_SESSION_TOKEN__
    delete win.__AURORA_AUTH_REQUIRED__
    delete win.__AURORA_UI_SURFACE__
  })

  it('recognizes the browser-hosted renderer marker', () => {
    document.documentElement.dataset.auroraDesktopHost = 'browser'
    expect(isBrowserHostedDesktop()).toBe(true)
  })

  it('recognizes a gated host before the bridge marker is written', () => {
    ;(window as HostWindow).__AURORA_AUTH_REQUIRED__ = true
    expect(isBrowserHostedDesktop()).toBe(true)
  })

  // The Webapp surface is served without an injected token; the bridge still
  // installs for it, so the pre-marker check must agree.
  it('recognizes the tokenless Webapp surface before the bridge marker is written', () => {
    ;(window as HostWindow).__AURORA_UI_SURFACE__ = 'webapp'
    expect(isBrowserHostedDesktop()).toBe(true)
  })

  // Nothing serves this renderer to a browser with only an injected dashboard token, and such a page
  // has no gateway route (the ticket route is the Webapp's): it must not install a bridge that can
  // never connect.
  it('does not treat a bare injected session token as a browser host', () => {
    ;(window as HostWindow).__AURORA_SESSION_TOKEN__ = 'served-token'
    expect(isBrowserHostedDesktop()).toBe(false)
  })

  it('does not treat Electron as browser-hosted', () => {
    document.documentElement.dataset.auroraDesktopHost = 'electron'
    expect(isBrowserHostedDesktop()).toBe(false)
  })
})
