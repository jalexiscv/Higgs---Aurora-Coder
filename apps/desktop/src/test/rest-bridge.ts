import { vi } from 'vitest'

import type { AuroraApiRequest } from '@/global'

/** Install a fake `window.auroraDesktop.api`, the preload bridge every REST helper sends through. */
export function installRestBridge(answer: (request: AuroraApiRequest) => object) {
  const api = vi.fn(async (request: AuroraApiRequest) => answer(request))

  Object.defineProperty(window, 'auroraDesktop', { configurable: true, value: { api } })

  return api
}
