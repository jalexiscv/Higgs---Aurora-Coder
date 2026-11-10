/**
 * The Webapp tab is served BY an Aurora Cloud agent (its own origin is the
 * agent). Cloud then owns every update: the app itself comes from that agent.
 * Kept free of the session store so low-level modules (notifications, the
 * settings manifest) can ask it without an import cycle.
 */

import { isAuroraCloudUrl } from '@aurora/shared'

import { isBrowserHostedDesktop } from '@/lib/platform'

export function servedByAuroraCloud(): boolean {
  return typeof window !== 'undefined' && isBrowserHostedDesktop() && isAuroraCloudUrl(window.location.origin)
}
