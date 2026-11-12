import { expect, test } from 'bun:test'
import { grade } from '../../server/lib/grading'
import { gradeLocal } from './grade'
import type { Q } from './types'

test('practice grading agrees with the server for NAT values and ranges', () => {
  for (const answer of ['100', '12.4..12.6', '-2|3.5', '1e-3']) {
    for (const given of ['100.05', '12.5', '-2', '0.001', '5oops', '']) {
      const q = { type: 'NAT', answer } as Q
      expect(gradeLocal(q, given)).toBe(grade(q, given))
    }
  }
})
