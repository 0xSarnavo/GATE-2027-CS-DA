import { useRef, useState } from 'preact/hooks'
import { evaluate, fmt, type AngleMode } from './calc'
import { Icon } from '../../ui'

type Key = { l: string; ins?: string; act?: string; cls?: string; aria?: string }
const K = (l: string, ins?: string, extra: Partial<Key> = {}): Key => ({ l, ins: ins ?? l, ...extra })
const KEYS: Key[][] = [
  [{ l: 'MC', act: 'mc', cls: 'mem', aria: 'Memory clear' }, { l: 'MR', act: 'mr', cls: 'mem', aria: 'Memory recall' }, { l: 'M+', act: 'm+', cls: 'mem', aria: 'Memory add' }, { l: 'M−', act: 'm-', cls: 'mem', aria: 'Memory subtract' }, { l: '⌫', act: 'bs', cls: 'fn', aria: 'Backspace' }],
  [K('sin', 'sin('), K('cos', 'cos('), K('tan', 'tan('), K('asin', 'asin('), K('acos', 'acos(')],
  [K('sinh', 'sinh('), K('cosh', 'cosh('), K('tanh', 'tanh('), K('eˣ', 'exp('), K('10ˣ', '10^(')],
  [K('ln', 'ln('), K('log', 'log('), K('√', 'sqrt('), K('x²', '^2'), K('xʸ', '^')],
  [K('(', '('), K(')', ')'), K('n!', '!'), { l: '1/x', act: 'inv' }, { l: '±', act: 'neg' }],
  [K('7'), K('8'), K('9'), K('÷', '÷', { cls: 'op' }), { l: 'C', act: 'c', cls: 'fn', aria: 'Clear all' }],
  [K('4'), K('5'), K('6'), K('×', '×', { cls: 'op' }), K('π', 'pi')],
  [K('1'), K('2'), K('3'), K('−', '-', { cls: 'op' }), K('e', 'e')],
  [K('0'), K('.'), K('%'), K('+', '+', { cls: 'op' }), { l: '=', act: 'eq', cls: 'eq' }],
]

/** On-screen scientific calculator (GATE provides one: basic and scientific functions). */
export function Calculator({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState('')
  const [res, setRes] = useState('0')
  const [mode, setMode] = useState<AngleMode>('deg')
  const [mem, setMem] = useState(0)
  const justEq = useRef(false)
  const cur = () => { try { return evaluate(expr, mode) } catch { return NaN } }
  const press = (k: Key) => {
    if (k.act) {
      if (k.act === 'c') { setExpr(''); setRes('0'); justEq.current = false }
      else if (k.act === 'bs') { setExpr(expr.replace(/(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|log|ln|sqrt|exp)\($|.$/, '')); justEq.current = false }
      else if (k.act === 'eq') { try { const v = evaluate(expr, mode); setRes(fmt(v)); if (isFinite(v)) { setExpr(String(parseFloat(v.toPrecision(12)))); justEq.current = true } } catch { setRes('Error') } }
      else if (k.act === 'inv') { setExpr(expr ? `1/(${expr})` : ''); }
      else if (k.act === 'neg') { setExpr(expr ? (expr.startsWith('-(') && expr.endsWith(')') ? expr.slice(2, -1) : `-(${expr})`) : '-') }
      else if (k.act === 'mc') setMem(0)
      else if (k.act === 'mr') { setExpr(expr + String(mem)); justEq.current = false }
      else if (k.act === 'm+') { const v = cur(); if (isFinite(v)) setMem(mem + v) }
      else if (k.act === 'm-') { const v = cur(); if (isFinite(v)) setMem(mem - v) }
      return
    }
    const t = k.ins!
    const isDigitStart = /^[\d.]|^pi$|^e$|^[a-z]/.test(t)
    // after "=" a number or function starts a new expression; an operator continues with the result
    setExpr((justEq.current && isDigitStart ? '' : expr) + t); justEq.current = false
    setRes('')
  }
  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'Escape') return onClose()
    if (k === 'Enter' || k === '=') { e.preventDefault(); return press({ l: '=', act: 'eq' }) }
    if (k === 'Backspace') return press({ l: '', act: 'bs' })
    if (/^[\d.+\-*/()^!%]$/.test(k)) { e.preventDefault(); press({ l: k, ins: k === '*' ? '×' : k === '/' ? '÷' : k }) }
  }
  return (
    <div class="calc" role="dialog" aria-label="Scientific calculator" onKeyDown={onKey}>
      <div class="calc-h"><b>Calculator</b>
        <button class="chip sm" aria-pressed={mode === 'deg'} onClick={() => setMode(mode === 'deg' ? 'rad' : 'deg')}>{mode === 'deg' ? 'DEG' : 'RAD'}</button>
        {mem !== 0 && <small aria-label="Memory in use">M</small>}
        <span class="grow" />
        <button class="icon-btn" aria-label="Close calculator" onClick={onClose}><Icon.close /></button></div>
      <output class="calc-d" aria-live="polite"><span class="calc-e">{expr || ' '}</span><b>{res || fmt(cur())}</b></output>
      <div class="calc-k">{KEYS.flat().map((k) => <button class={'ck ' + (k.cls ?? '')} aria-label={k.aria} onClick={() => press(k)}>{k.l}</button>)}</div>
    </div>
  )
}
