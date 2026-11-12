import { expect, test } from 'bun:test'
import { isMidTask, updateAction } from './update-policy'

test('update card is reserved for active questions and tests', () => {
  expect(isMidTask('#/q/123')).toBe(true)
  expect(isMidTask('#/test/run/123')).toBe(true)
  expect(isMidTask('#/q/done')).toBe(false)
  expect(isMidTask('#/cards/review')).toBe(false)
  expect(isMidTask('#/today')).toBe(false)
})

test('Later suppresses only the waiting build until a later version', () => {
  expect(updateAction(true, false, null, 'v2')).toBe('apply')
  expect(updateAction(true, true, null, 'v2')).toBe('card')
  expect(updateAction(true, true, 'v2', 'v2')).toBe('none')
  expect(updateAction(true, true, 'v2', 'v3')).toBe('card')
  expect(updateAction(true, true, null, null)).toBe('none')
})
