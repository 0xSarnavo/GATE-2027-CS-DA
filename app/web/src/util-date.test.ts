import { expect, test } from 'bun:test'
import { addDays, setToday, today } from './util'

test('server-calibrated today advances across IST midnight', () => {
  const now = new Date()
  const serverDay = addDays(today(now), 3)
  setToday(serverDay)
  expect(today(now)).toBe(serverDay)
  expect(today(new Date(now.getTime() + 864e5))).toBe(addDays(serverDay, 1))
})
