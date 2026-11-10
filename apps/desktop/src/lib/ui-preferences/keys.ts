/**
 * Which persisted keys are machine-level UI preferences (#145213).
 *
 * Only these leave localStorage for the machine's shared store, so native
 * Desktop and every browser that opens this machine's Webapp show the same
 * choices. Scoped families keep their scope inside the key name (a
 * `….profile.<name>` or per-connection suffix): only the location changes.
 *
 * Deliberately NOT here (they stay in this browser/window):
 * - credentials, grants and connection config: gateway registry, custom model
 *   endpoints, plugin decisions and preview-script grants, embed permissions;
 * - per-window or per-device runtime state: layout tree, open tiles and tabs,
 *   last route/session, scroll, zoom, pet and popout geometry, keep-awake;
 * - drafts, queues, journals and caches: composer queue, in-flight turns,
 *   pending/prepared submissions, previews, pricing, backend skin cache, the
 *   "provider configured" onboarding cache (each backend answers that itself);
 * - one-off notices: butterbar, update and real-profile prompts.
 */

const SHARED_KEYS: ReadonlySet<string> = new Set([
  // Appearance.
  'aurora-desktop-theme-v2',
  'aurora-desktop-mode-v1',
  'aurora-desktop-profile-themes-v1',
  'aurora-desktop-profile-modes-v1',
  'aurora-desktop-user-themes-v1',
  'aurora.desktop.backdrop.v1',
  'aurora.desktop.chat-text-scale.v1',
  'aurora.desktop.interfaceMode.v1',
  'aurora.desktop.textDirection',
  'aurora.desktop.translucency.v2',
  'aurora.desktop.user-bubble-transparency.v1',
  // Sessions sidebar and profile rail.
  'aurora.desktop.agentsGroupedByWorkspace',
  'aurora.desktop.profileColors',
  'aurora.desktop.profileOrder',
  'aurora.desktop.profileRailVisible',
  'aurora.desktop.sessionListDensity',
  'aurora.desktop.sessionOrder',
  'aurora.desktop.sessionOrder.manual',
  'aurora.desktop.showAllProfiles',
  'aurora.desktop.sidebarAgentsGrouped.allProfiles',
  'aurora.desktop.sidebarCardRows',
  'aurora.desktop.sidebarGrouping',
  'aurora.desktop.sidebarGrouping.allProfiles',
  'aurora.desktop.sidebarRowMeta',
  'aurora.desktop.sidebarShowAllSessions',
  'aurora.desktop.sidebarShowArchived',
  'aurora.desktop.sidebarSortKey',
  // Status bar.
  'aurora.desktop.statusbarHidden.v2',
  'aurora.desktop.statusbarVisible.v2',
  // Transcript and tools.
  'aurora.desktop.hideThreadTimeline',
  'aurora.desktop.reasoning.collapsedByDefault',
  'aurora.desktop.toolView.hideCodeDiffs',
  'aurora.desktop.toolView.technical',
  // Shell, panes and behaviour.
  'aurora.desktop.alwaysExternalLinks.v1',
  'aurora.desktop.capabilities.catalogCardView',
  'aurora.desktop.composerPopout.enabled',
  'aurora.desktop.composerPopout.gesturesEnabled',
  'aurora.desktop.files.showIgnored',
  'aurora.desktop.keybinds',
  'aurora.desktop.layoutPresets.v2',
  'aurora.desktop.panesFlipped',
  'aurora.desktop.tabStripDefault',
  'aurora.desktop.titlebarAppActions',
  // Guidance: what the user already skipped, saw or dismissed does not come
  // back in every new browser or origin (#145600).
  'aurora-onboarding-skipped-v1',
  'aurora.desktop.tips.last.v1',
  'aurora.desktop.tips.next.v1',
  'aurora.desktop.tips.retired.v1',
  'aurora.desktop.tips.rotation.v1',
  'aurora.desktop.tips.shownAt.v1',
  'aurora.desktop.tours.v1',
  // Sound and media.
  'aurora.desktop.autoSpeakReplies',
  'aurora.desktop.completionSoundVariantId',
  'aurora.desktop.hapticsMuted',
  'aurora.desktop.videoPlaybackSpeed',
  // Model picker.
  'aurora.desktop.collapsed-providers',
  'aurora.desktop.favorite-models',
  // visible-models is a diff against known-models: they only make sense together.
  'aurora.desktop.known-models',
  'aurora.desktop.model-presets',
  'aurora.desktop.visible-models'
])

/** Families whose scope rides in the key suffix (gateway aliases/order/collapsed). */
const SHARED_PREFIXES: readonly string[] = ['aurora.desktop.sidebar.gatewayGroups.v1.']

export function isSharedPreferenceKey(key: string): boolean {
  return SHARED_KEYS.has(key) || SHARED_PREFIXES.some(prefix => key.startsWith(prefix))
}
