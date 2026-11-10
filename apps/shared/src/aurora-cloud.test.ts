import { describe, expect, it } from 'vitest'

import { isAuroraCloudUrl } from './aurora-cloud'

describe('isAuroraCloudUrl', () => {
  it('recognises production and staging agent hosts, nothing else', () => {
    expect(isAuroraCloudUrl('https://ares-3009.agents.nousresearch.com')).toBe(true)
    expect(isAuroraCloudUrl('https://ares--app.agents.staging-nousresearch.com/')).toBe(true)
    expect(isAuroraCloudUrl('https://agents.nousresearch.com.evil.example')).toBe(false)
    expect(isAuroraCloudUrl('https://my-box.tailnet.ts.net')).toBe(false)
    expect(isAuroraCloudUrl('not a url')).toBe(false)
    expect(isAuroraCloudUrl(undefined)).toBe(false)
  })
})
