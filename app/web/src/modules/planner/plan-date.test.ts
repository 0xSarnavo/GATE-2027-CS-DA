import { expect, test } from 'bun:test'
import { planDate } from './plan-date'
import { today } from '../../util'

test('Plan accepts only real ISO dates', () => {
  expect(planDate('2027-02-06')).toBe('2027-02-06')
  for (const part of [undefined, 'calendar', '2027-02-30', '2027-2-06', '2027-02-06x']) expect(planDate(part)).toBe(today())
})
