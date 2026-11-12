import { test, expect } from 'bun:test'
import { evaluate, fmt } from './calc'

test('arithmetic precedence and unary minus', () => {
  expect(evaluate('2+3*4')).toBe(14)
  expect(evaluate('-2^2')).toBe(-4)
  expect(evaluate('2^-1')).toBe(0.5)
  expect(evaluate('(1+2)(3+4)')).toBe(21)
  expect(evaluate('10÷4')).toBe(2.5)
})
test('scientific functions in degrees and radians', () => {
  expect(evaluate('sin(30)', 'deg')).toBeCloseTo(0.5)
  expect(evaluate('cos(pi)', 'rad')).toBeCloseTo(-1)
  expect(evaluate('log(1000)')).toBeCloseTo(3)
  expect(evaluate('ln(e)')).toBeCloseTo(1)
  expect(evaluate('5!')).toBe(120)
  expect(evaluate('sqrt(16)+2^3')).toBe(12)
  expect(evaluate('50%')).toBe(0.5)
})
test('bad input throws, format is tidy', () => {
  expect(() => evaluate('2+*')).toThrow()
  expect(() => evaluate('foo(1)')).toThrow()
  expect(fmt(1 / 3)).toBe('0.3333333333')
  expect(fmt(0.1 + 0.2)).toBe('0.3')
  expect(fmt(NaN)).toBe('Error')
})
