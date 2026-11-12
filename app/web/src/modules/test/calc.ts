/** Scientific calculator engine for the on-screen GATE-style calculator. No eval: a small tokenizer + recursive-descent parser. */
export type AngleMode = 'deg' | 'rad'
const FUNCS: Record<string, (x: number, deg: boolean) => number> = {
  sin: (x, d) => Math.sin(d ? (x * Math.PI) / 180 : x), cos: (x, d) => Math.cos(d ? (x * Math.PI) / 180 : x), tan: (x, d) => Math.tan(d ? (x * Math.PI) / 180 : x),
  asin: (x, d) => (d ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)), acos: (x, d) => (d ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)), atan: (x, d) => (d ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
  sinh: (x) => Math.sinh(x), cosh: (x) => Math.cosh(x), tanh: (x) => Math.tanh(x),
  log: (x) => Math.log10(x), ln: (x) => Math.log(x), sqrt: (x) => Math.sqrt(x), cbrt: (x) => Math.cbrt(x), exp: (x) => Math.exp(x), abs: (x) => Math.abs(x),
}
const fact = (n: number) => { if (n < 0 || !Number.isInteger(n) || n > 170) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }

export function evaluate(src: string, mode: AngleMode = 'deg'): number {
  const s = src.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
  let i = 0
  const peek = () => s[i]
  const num = (): number => {
    const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)
    if (!m) throw new Error('syntax')
    i += m[0].length; return parseFloat(m[0])
  }
  const primary = (): number => {
    const c = peek()
    if (c === '(') { i++; const v = add(); if (peek() !== ')') throw new Error('syntax'); i++; return v }
    if (c && /[a-z]/i.test(c)) {
      const m = s.slice(i).match(/^[a-z]+/i)![0].toLowerCase(); i += m.length
      if (m === 'pi') return Math.PI
      if (m === 'e') return Math.E
      const f = FUNCS[m]; if (!f) throw new Error('unknown ' + m)
      if (peek() !== '(') throw new Error('syntax')
      i++; const v = add(); if (peek() !== ')') throw new Error('syntax'); i++
      return f(v, mode === 'deg')
    }
    return num()
  }
  const postfix = (): number => {
    let v = primary()
    for (;;) {
      if (peek() === '!') { i++; v = fact(v) } else if (peek() === '%') { i++; v = v / 100 } else break
    }
    return v
  }
  const power = (): number => { const b = postfix(); if (peek() === '^') { i++; return Math.pow(b, unary()) } return b }
  const unary = (): number => { if (peek() === '-') { i++; return -unary() } if (peek() === '+') { i++; return unary() } return power() }
  const mul = (): number => {
    let v = unary()
    for (;;) {
      const c = peek()
      if (c === '*') { i++; v *= unary() } else if (c === '/') { i++; v /= unary() }
      else if (c === '(' || (c && /[a-z]/i.test(c))) v *= unary() // implicit multiplication: 2(3), 2pi
      else break
    }
    return v
  }
  const add = (): number => { let v = mul(); for (;;) { const c = peek(); if (c === '+') { i++; v += mul() } else if (c === '-') { i++; v -= mul() } else break } return v }
  if (!s) return 0
  const v = add()
  if (i < s.length) throw new Error('syntax')
  return v
}

/** Display format: up to 10 significant digits, exponent form for very large/small values. */
export function fmt(n: number): string {
  if (!isFinite(n)) return 'Error'
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e12 || a < 1e-7) return n.toExponential(6).replace(/\.?0+e/, 'e')
  return String(parseFloat(n.toPrecision(10)))
}
