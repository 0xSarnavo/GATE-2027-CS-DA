import { expect, test } from 'bun:test'
import { goalProgress } from './goal-progress'

test('daily goal caps both parts and allows turning questions off', () => {
  expect(goalProgress(180, 180, 15, 30)).toMatchObject({ combined: .75, reached: false })
  expect(goalProgress(200, 180, 40, 30)).toMatchObject({ combined: 1, reached: true })
  expect(goalProgress(180, 180, 0, 0)).toMatchObject({ combined: 1, reached: true })
})
