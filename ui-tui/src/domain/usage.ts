import type { Usage } from '@aurora/shared/gateway-events'

export { usageFromTick } from '@aurora/shared/usage-tick'

export const ZERO: Usage = { calls: 0, input: 0, output: 0, total: 0 }
