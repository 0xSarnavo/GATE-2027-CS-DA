import { expect, mock, test } from 'bun:test'

const disk = new Map<string, unknown>()
let fail = false
mock.module('idb-keyval', () => ({
  get: async (key: string) => disk.get(key),
  set: async (key: string, value: unknown) => { if (fail) throw new Error('storage full'); disk.set(key, structuredClone(value)) },
}))

const { enqueue, drain, initOutbox, syncState } = await import('./store')

test('outbox persists rejected writes and continues with later writes', async () => {
  await initOutbox()
  await Promise.all([enqueue('POST', '/a', { note: 'keep' }), enqueue('POST', '/b', {})])
  await drain(async it => it.path === '/a' ? { failed: '422: invalid' } : 'ok')
  expect(disk.get('outbox')).toMatchObject([{ path: '/a', body: { note: 'keep' }, failed: '422: invalid' }])
  expect(syncState()).toMatchObject({ queued: 1, failed: 1 })
})

test('outbox reports a failed durable write', async () => {
  fail = true
  await expect(enqueue('POST', '/c', {})).rejects.toThrow('storage full')
  fail = false
})
