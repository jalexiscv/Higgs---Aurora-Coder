import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.auroraDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('aurora:translucency:support')
const hudWindowing = ipcRenderer.sendSync('aurora:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true

const launchFlags: { localModels?: boolean; assumeFreshInstall?: boolean } | undefined =
  ipcRenderer.sendSync('aurora:feature-flags')

// Local, sanitized skin payload for the first renderer theme paint. This does
// not wait on `gateway.ready`, so an unreachable remote primary cannot force
// the built-in palette over the skin configured on this machine.
const localSkin = ipcRenderer.sendSync('aurora:skin:local')

// This machine's UI preferences store (#145213), read before the first paint so
// a preference set in another window or in this machine's Webapp paints at once.
const uiPreferencesSnapshot = ipcRenderer.sendSync('aurora:ui-preferences:snapshot')

import { unwrapExpectedNotFound } from './api-expected-404'

contextBridge.exposeInMainWorld('auroraDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  // Dev-only launch fact: an unpackaged app started with --fresh-install, so
  // onboarding treats this launch as a fresh install. Always false when packaged.
  assumeFreshInstall: launchFlags?.assumeFreshInstall === true,
  localSkin: localSkin && typeof localSkin === 'object' ? localSkin : null,
  uiPreferences: {
    snapshot: uiPreferencesSnapshot && typeof uiPreferencesSnapshot === 'object' ? uiPreferencesSnapshot : null,
    read: () => ipcRenderer.invoke('aurora:ui-preferences:read'),
    write: payload => ipcRenderer.invoke('aurora:ui-preferences:write', payload),
    onChanged: callback => {
      const listener = (_event, snapshot) => callback(snapshot)
      ipcRenderer.on('aurora:ui-preferences:changed', listener)

      return () => ipcRenderer.removeListener('aurora:ui-preferences:changed', listener)
    }
  },
  getConnection: (profile, opts) => ipcRenderer.invoke('aurora:connection', profile, opts),
  // Loopback origin that hosts YouTube's player for the file:// renderer.
  getEmbedHostOrigin: () => ipcRenderer.invoke('aurora:embed-host:origin'),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('aurora:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('aurora:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('aurora:connection:revalidate'),
  getGatewayWsUrl: profile => ipcRenderer.invoke('aurora:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('aurora:gateway:ws-url-for', payload),
  // { connectionId, profile, pluginId, path } → one-use local plugin socket URL, null, or { refused: 'permission' }.
  getPluginWsUrl: payload => ipcRenderer.invoke('aurora:plugin:ws-url', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('aurora:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('aurora:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('aurora:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('aurora:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('aurora:window:openBrowser', tabId),
  windowRelay: {
    send: payload => ipcRenderer.send('aurora:window:relay', payload),
    onMessage: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:window:relay', listener)

      return () => ipcRenderer.removeListener('aurora:window:relay', listener)
    }
  },
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('aurora:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('aurora:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('aurora:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('aurora:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('aurora:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('aurora:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('aurora:wake-indicator:get'),
    setState: state => ipcRenderer.send('aurora:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('aurora:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('aurora:wake-indicator:state', listener)
    }
  },
  chatOnboarding: {
    size: mode => ipcRenderer.send('aurora:window:size', mode)
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('aurora:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('aurora:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('aurora:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('aurora:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('aurora:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('aurora:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('aurora:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('aurora:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('aurora:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('aurora:hud:open', request),
    close: () => ipcRenderer.invoke('aurora:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('aurora:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('aurora:hud:begin-move'),
    endMove: () => ipcRenderer.send('aurora:hud:end-move'),
    moveBy: delta => ipcRenderer.send('aurora:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('aurora:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('aurora:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('aurora:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('aurora:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('aurora:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('aurora:hud:goto', listener)

      return () => ipcRenderer.removeListener('aurora:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('aurora:hud:changed', listener)

      return () => ipcRenderer.removeListener('aurora:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('aurora:hud:cursor', listener)

      return () => ipcRenderer.removeListener('aurora:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('aurora:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('aurora:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('aurora:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('aurora:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('aurora:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('aurora:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('aurora:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('aurora:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('aurora:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('aurora:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('aurora:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('aurora:screenshot:status', listener)

            return () => ipcRenderer.removeListener('aurora:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'aurora:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('aurora:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('aurora:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('aurora:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('aurora:quick-entry:settings:set', patch),
    // Invoke returns the delivery result so the draft is not lost (#85590).
    submit: payload => ipcRenderer.invoke('aurora:quick-entry:submit', payload),
    // Main cannot invoke the primary renderer, so it receives this ack (#85590).
    ackSubmit: (correlationId, result) => ipcRenderer.send('aurora:quick-entry:ack', { correlationId, result }),
    dismiss: () => ipcRenderer.send('aurora:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('aurora:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('aurora:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('aurora:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('aurora:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('aurora:quick-entry:shown', listener)
    },
    // Main → quick window: the outcome of a submit whose relay already timed
    // out. Delivery is now KNOWN — reconcile the unknown state instead of
    // leaving the user to resend a prompt that may already be delivered.
    onLateResult: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:quick-entry:late-result', listener)

      return () => ipcRenderer.removeListener('aurora:quick-entry:late-result', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('aurora:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('aurora:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('aurora:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('aurora:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('aurora:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('aurora:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('aurora:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('aurora:connections:list'),
    save: payload => ipcRenderer.invoke('aurora:connections:save', payload),
    remove: id => ipcRenderer.invoke('aurora:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('aurora:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('aurora:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('aurora:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('aurora:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('aurora:connections:update-managed', id),
    // Fan out `aurora update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('aurora:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:connections:changed', listener)

      return () => ipcRenderer.removeListener('aurora:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('aurora:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('aurora:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('aurora:connection-config:probe', remoteUrl),
  // `options` lets a registry-editor draft sign in BEFORE it is saved: the
  // main process settles the draft's connection id up front so the login
  // window writes into the per-connection cookie jar the saved entry will
  // read (not the legacy shared jar an unsaved URL would fall back to).
  oauthLoginConnectionConfig: (remoteUrl, options) =>
    ipcRenderer.invoke('aurora:connection-config:oauth-login', remoteUrl, options),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('aurora:connection-config:oauth-logout', remoteUrl),
  // Aurora Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('aurora:cloud:status'),
    login: () => ipcRenderer.invoke('aurora:cloud:login'),
    logout: () => ipcRenderer.invoke('aurora:cloud:logout'),
    discover: org => ipcRenderer.invoke('aurora:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('aurora:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    getDefault: () => ipcRenderer.invoke('aurora:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('aurora:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('aurora:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('aurora:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('aurora:profile:get'),
    remember: name => ipcRenderer.invoke('aurora:profile:remember', name),
    importConnections: (record: Record<string, string>) =>
      ipcRenderer.invoke('aurora:profile:connections:import', record),
    rememberConnection: (connectionId: string, profile: string) =>
      ipcRenderer.invoke('aurora:profile:connections:remember', connectionId, profile),
    set: name => ipcRenderer.invoke('aurora:profile:set', name)
  },
  // The handler resolves an expected 404 with a sentinel instead of rejecting
  // (Electron logs a stack for every rejected invoke). Turn it back into the
  // rejection the renderer expects — see electron/api-expected-404.ts.
  api: request => ipcRenderer.invoke('aurora:api', request).then(unwrapExpectedNotFound),
  notify: payload => ipcRenderer.invoke('aurora:notify', payload),
  claimStartupLatency: () => ipcRenderer.invoke('aurora:startup-latency:claim'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('aurora:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('aurora:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('aurora:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('aurora:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('aurora:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('aurora:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('aurora:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('aurora:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('aurora:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('aurora:selectSavePath', options),
  saveTextFileAs: request => ipcRenderer.invoke('aurora:saveTextFileAs', request),
  writeClipboard: text => ipcRenderer.invoke('aurora:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('aurora:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('aurora:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('aurora:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('aurora:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('aurora:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('aurora:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('aurora:context-menu:guest-add-word', payload),
  spellcheckDictionary: (op, word) => ipcRenderer.invoke('aurora:spellcheck:dictionary', { op, word }),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('aurora:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('aurora:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('aurora:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('aurora:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('aurora:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('aurora:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('aurora:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('aurora:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('aurora:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('aurora:active-work', payload),
  scheduleStreamWorkWake: (token, delayMs) => ipcRenderer.send('aurora:stream-work-wake', { token, delayMs }),
  onStreamWorkWake: callback => {
    const listener = (_event, token) => callback(token)
    ipcRenderer.on('aurora:stream-work-ready', listener)

    return () => ipcRenderer.removeListener('aurora:stream-work-ready', listener)
  },
  setTitleBarTheme: payload => ipcRenderer.send('aurora:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('aurora:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('aurora:translucency', payload),
  setKeepAwake: mode => ipcRenderer.send('aurora:keep-awake', mode),
  // Once per computer, after a timed sleep interrupted a turn with keep-awake off.
  onKeepAwakeOffer: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:keep-awake-offer', listener)

    return () => ipcRenderer.removeListener('aurora:keep-awake-offer', listener)
  },
  minimizeToTray: {
    get: () => ipcRenderer.invoke('aurora:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('aurora:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('aurora:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('aurora:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('aurora:devtools:disable-f12', blocked),
  setF12ShortcutActive: active => ipcRenderer.send('aurora:f12ShortcutActive', Boolean(active)),
  onF12Shortcut: callback => {
    const listener = (_event, input) => callback(input)
    ipcRenderer.on('aurora:f12-shortcut', listener)

    return () => ipcRenderer.removeListener('aurora:f12-shortcut', listener)
  },
  setPreviewShortcutActive: active => ipcRenderer.send('aurora:previewShortcutActive', Boolean(active)),
  setPreviewGuestHidden: (webContentsId, hidden) =>
    ipcRenderer.send('aurora:preview-guest-hidden', { webContentsId, hidden: Boolean(hidden) }),
  beginPreviewGuestActivity: webContentsId => ipcRenderer.invoke('aurora:preview-guest-activity:begin', webContentsId),
  endPreviewGuestActivity: token => ipcRenderer.invoke('aurora:preview-guest-activity:end', token),
  executePreviewGuestScript: (token, code) => ipcRenderer.invoke('aurora:preview-guest-activity:script', token, code),
  syncPreviewSignins: request => ipcRenderer.invoke('aurora:preview-signins:sync', request),
  migratePreviewSigninsForProfile: (request: { oldProfile: string; newProfile: string }) =>
    ipcRenderer.invoke('aurora:preview-signins:profile-renamed', request),
  dropPreviewSigninsForProfile: (request: { profile: string }) =>
    ipcRenderer.invoke('aurora:preview-signins:profile-deleted', request),
  openExternal: url => ipcRenderer.invoke('aurora:openExternal', url),
  freeTierChallenge: {
    // Load the account service's challenge page in a hidden window (revealed
    // only if the page asks for the human). Resolves with how it ended.
    run: request => ipcRenderer.invoke('aurora:freeTierChallenge:run', request)
  },
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('aurora:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('aurora:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('aurora:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('aurora:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('aurora:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('aurora:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('aurora:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('aurora:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('aurora:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('aurora:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('aurora:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('aurora:setting:defaultProjectDir:pick')
  },
  preparedSubmissions: {
    read: () => ipcRenderer.invoke('aurora:prepared-submissions:read'),
    update: (key, entry) => ipcRenderer.invoke('aurora:prepared-submissions:update', key, entry),
    compareAndSet: (key, expected, entry) =>
      ipcRenderer.invoke('aurora:prepared-submissions:compare-and-set', key, expected, entry)
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('aurora:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('aurora:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:zoom:changed', listener)

      return () => ipcRenderer.removeListener('aurora:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('aurora:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('aurora:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('aurora:logs:renderer-error', report),
  logLine: (line: string): void => ipcRenderer.send('aurora:logs:renderer-line', line),
  readDir: dirPath => ipcRenderer.invoke('aurora:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('aurora:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('aurora:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('aurora:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('aurora:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: async () => (await ipcRenderer.invoke('aurora:fs:reconcileDesktopPlugins')).published,
  reconcileDesktopPluginsReport: () => ipcRenderer.invoke('aurora:fs:reconcileDesktopPlugins'),
  logsRoot: (profile?: string) => ipcRenderer.invoke('aurora:fs:logsRoot', profile),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('aurora:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('aurora:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('aurora:fs:trash', targetPath),
  pluginFiles: {
    request: (pluginId, labels) => ipcRenderer.invoke('aurora:pluginFiles:request', pluginId, labels),
    grants: pluginId => ipcRenderer.invoke('aurora:pluginFiles:grants', pluginId),
    revoke: (pluginId, folderId) => ipcRenderer.invoke('aurora:pluginFiles:revoke', pluginId, folderId),
    op: (pluginId, request) => ipcRenderer.invoke('aurora:pluginFiles:op', pluginId, request),
    onChanged: callback => {
      const listener = (_event, change) => callback(change)
      ipcRenderer.on('aurora:pluginFiles:changed', listener)

      return () => ipcRenderer.removeListener('aurora:pluginFiles:changed', listener)
    }
  },
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('aurora:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('aurora:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('aurora:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('aurora:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('aurora:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('aurora:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('aurora:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('aurora:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('aurora:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('aurora:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('aurora:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('aurora:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('aurora:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('aurora:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('aurora:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('aurora:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('aurora:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('aurora:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('aurora:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('aurora:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('aurora:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('aurora:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('aurora:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('aurora:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('aurora:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('aurora:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('aurora:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `aurora:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `aurora:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('aurora:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('aurora:preview-nav', listener)

    return () => ipcRenderer.removeListener('aurora:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('aurora:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:open-updates', listener)

    return () => ipcRenderer.removeListener('aurora:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:deep-link', listener)

    return () => ipcRenderer.removeListener('aurora:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('aurora:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('aurora:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('aurora:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('aurora:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:window-state-changed', listener)

    return () => ipcRenderer.removeListener('aurora:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('aurora:focus-session', listener)

    return () => ipcRenderer.removeListener('aurora:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:notification-action', listener)

    return () => ipcRenderer.removeListener('aurora:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:notification-activate', listener)

    return () => ipcRenderer.removeListener('aurora:notification-activate', listener)
  },
  onExternalOpenFailed: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:external-open-failed', listener)

    return () => ipcRenderer.removeListener('aurora:external-open-failed', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('aurora:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:backend-exit', listener)

    return () => ipcRenderer.removeListener('aurora:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:connection:applied', listener)

    return () => ipcRenderer.removeListener('aurora:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:power-resume', listener)

    return () => ipcRenderer.removeListener('aurora:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('aurora:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('aurora:power-battery', listener)

    return () => ipcRenderer.removeListener('aurora:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:boot-progress', listener)

    return () => ipcRenderer.removeListener('aurora:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('aurora:bootstrap:get'),
  probeLocalBackend: () => ipcRenderer.invoke('aurora:local-backend:probe'),
  continueBootstrapLocal: () => ipcRenderer.invoke('aurora:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('aurora:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('aurora:bootstrap:reset'),
  updateHold: {
    recheck: () => ipcRenderer.invoke('aurora:update-hold:recheck'),
    quit: () => ipcRenderer.invoke('aurora:update-hold:quit'),
    startAnyway: (request: { holdId: string; confirmed: true }) =>
      ipcRenderer.invoke('aurora:update-hold:start-anyway', request)
  },
  repairBootstrap: () => ipcRenderer.invoke('aurora:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('aurora:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('aurora:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('aurora:bootstrap:event', listener)
  },
  getVersion: (scope?: { connectionId?: string; profile?: string }) => ipcRenderer.invoke('aurora:version', scope),
  relaunchApp: () => ipcRenderer.invoke('aurora:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('aurora:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('aurora:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('aurora:uninstall:summary'),
    run: mode => ipcRenderer.invoke('aurora:uninstall:run', { mode }),
    openAppsSettings: () => ipcRenderer.invoke('aurora:uninstall:openAppsSettings')
  },
  updates: {
    check: opts => ipcRenderer.invoke('aurora:updates:check', opts),
    apply: opts => ipcRenderer.invoke('aurora:updates:apply', opts),
    setChannel: name => ipcRenderer.invoke('aurora:updates:channel:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('aurora:updates:progress', listener)

      return () => ipcRenderer.removeListener('aurora:updates:progress', listener)
    },
    takePendingRun: () => ipcRenderer.invoke('aurora:updates:metric:take'),
    ackPendingRun: sent => ipcRenderer.invoke('aurora:updates:metric:ack', sent),
    onPendingRun: callback => {
      const listener = () => callback()
      ipcRenderer.on('aurora:updates:metric:pending', listener)

      return () => ipcRenderer.removeListener('aurora:updates:metric:pending', listener)
    }
  },
  desktopMetrics: {
    setEnabled: (on, profile) => ipcRenderer.invoke('aurora:desktop-metrics:set-enabled', on, profile),
    takeRendererCrashes: () => ipcRenderer.invoke('aurora:desktop-metrics:crash:take'),
    ackRendererCrashes: sent => ipcRenderer.invoke('aurora:desktop-metrics:crash:ack', sent)
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('aurora:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('aurora:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('aurora:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('aurora:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('aurora:found-in-page', listener)

    return () => ipcRenderer.removeListener('aurora:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('aurora:open-find-bar', listener)

    return () => ipcRenderer.removeListener('aurora:open-find-bar', listener)
  }
})
