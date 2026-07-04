import { test } from 'node:test'
import { strict as assert } from 'node:assert'

import { resolveSystemTimezone } from '../src/routes/settings.js'

const originalDateTimeFormat = Intl.DateTimeFormat

function withMockedTimezone<T>(
  detectedTimezone: string | undefined,
  validTimezones: string[],
  callback: () => T
) {
  const mockedDateTimeFormat = ((_locale?: string | string[], options?: Intl.DateTimeFormatOptions) => {
    if (options?.timeZone) {
      if (!validTimezones.includes(options.timeZone)) throw new RangeError('Invalid time zone')
      return { format: () => '' } as Intl.DateTimeFormat
    }

    return {
      resolvedOptions: () => ({ timeZone: detectedTimezone })
    } as Intl.DateTimeFormat
  }) as typeof Intl.DateTimeFormat

  Object.defineProperty(Intl, 'DateTimeFormat', {
    configurable: true,
    value: mockedDateTimeFormat
  })

  try {
    return callback()
  } finally {
    Object.defineProperty(Intl, 'DateTimeFormat', {
      configurable: true,
      value: originalDateTimeFormat
    })
  }
}

test('resolveSystemTimezone returns detected Intl timezone first', () => {
  process.env.TZ = 'Etc/UTC'
  const timezone = withMockedTimezone('Asia/Shanghai', ['Etc/UTC'], () => resolveSystemTimezone())
  assert.equal(timezone, 'Asia/Shanghai')
})

test('resolveSystemTimezone falls back to valid TZ environment variable', () => {
  process.env.TZ = 'Etc/UTC'
  const timezone = withMockedTimezone(undefined, ['Etc/UTC'], () => resolveSystemTimezone())
  assert.equal(timezone, 'Etc/UTC')
})

test('resolveSystemTimezone falls back to Asia/Shanghai for invalid TZ environment variable', () => {
  process.env.TZ = 'zh-CN'
  const timezone = withMockedTimezone(undefined, [], () => resolveSystemTimezone())
  assert.equal(timezone, 'Asia/Shanghai')
})
