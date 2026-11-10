import type { SharedMetricsConsentResult } from '@aurora/shared'

/** Public page describing exactly what shared metrics contain and how consent windows work. */
export const SHARED_METRICS_DOCS_URL = 'https://hermes-agent.nousresearch.com/docs/developer-guide/relay-shared-metrics'

export type SharedMetricsConsent = SharedMetricsConsentResult

export type SharedMetricsRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

/**
 * Name the profile on every consent RPC: an unscoped one resolves to the
 * backend's launch home, so on a shared backend the answer landed in another
 * profile's config.yaml and the focused profile's offer never retired (#130714).
 * `custom` is an AURORA_HOME outside profiles/ the backend cannot resolve by
 * name; there the ambient route already is that home.
 */
export function sharedMetricsProfileRequester(
  request: SharedMetricsRequester,
  profile: string
): SharedMetricsRequester {
  return profile === 'custom' ? request : (method, params = {}) => request(method, { ...params, profile })
}

function isConsent(value: unknown): value is SharedMetricsConsent {
  return typeof value === 'object' && value !== null && typeof (value as SharedMetricsConsent).decided === 'boolean'
}

/**
 * The profile's opt-ins, straight from its config.yaml (the backend is the
 * only authority; nothing is latched in the renderer, so an answer given in
 * `aurora setup` and one given here are the same answer). `null` when the
 * backend could not say — an older backend without the method, or a flap —
 * which every caller treats as "don't ask".
 */
export async function readSharedMetricsConsent(request: SharedMetricsRequester): Promise<SharedMetricsConsent | null> {
  try {
    const consent = await request<SharedMetricsConsent>('shared_metrics.status')

    return isConsent(consent) ? consent : null
  } catch {
    return null
  }
}

/** Write both opt-ins; the backend forces `send` off without `enabled` and reconciles consent. */
export async function saveSharedMetricsConsent(
  request: SharedMetricsRequester,
  flags: { enabled: boolean; send: boolean }
): Promise<SharedMetricsConsent> {
  const consent = await request<SharedMetricsConsent>('shared_metrics.set', flags)

  if (!isConsent(consent)) {
    throw new Error('Unexpected shared_metrics.set response')
  }

  return consent
}

/**
 * Send the packaged self-update run main persisted (it survives the restart
 * that applied it). Main keeps the record until the RPC resolves, and its claim
 * makes concurrent callers a no-op. Fire-and-forget: errors are swallowed.
 */
export async function reportPendingUpdateRun(request: SharedMetricsRequester): Promise<void> {
  const updates = window.auroraDesktop?.updates

  try {
    const run = await updates?.takePendingRun?.()

    if (!run) {
      return
    }

    let sent = false

    try {
      await request('shared_metrics.update_run', { ...run })
      sent = true
    } finally {
      await updates?.ackPendingRun?.(sent)
    }
  } catch {
    // Telemetry never surfaces; an unsent record retries on the next attach.
  }
}
