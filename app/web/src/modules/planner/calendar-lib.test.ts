import { describe, expect, test } from 'bun:test'
import { clampMonth, dayStat, monthGrid, phaseKind, shiftMonth, startTarget, taskState, byTime, updateTaskInDays, weeksWithDays } from './calendar-lib'

const t = (o: any) => ({ id: 'x', date: '2026-10-08', title: 't', type: 'study', est_minutes: 30, priority: 2, status: 'todo', ...o })
describe('calendar helpers', () => {
  test('monthGrid is Monday-first and padded to whole weeks', () => {
    const g = monthGrid('2026-10') // 1 Oct 2026 is a Thursday
    expect(g.length % 7).toBe(0); expect(g.indexOf('2026-10-01')).toBe(3); expect(g.filter(Boolean).length).toBe(31)
    expect(monthGrid('2027-02').filter(Boolean).length).toBe(28)
  })
  test('month navigation clamps to Oct 2026 - Feb 2027', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01'); expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(clampMonth('2026-09')).toBe('2026-10'); expect(clampMonth('2027-05')).toBe('2027-02')
  })
  test('phase kinds', () => {
    expect(phaseKind({ id: 'p1_habit', name: 'Habit-building' })).toBe('habit')
    expect(phaseKind({ id: 'p2_puja', name: 'Durga Puja break' })).toBe('break')
    expect(phaseKind({ id: 'p4_full1', name: 'Full plan I - shared core' })).toBe('full')
    expect(phaseKind({ id: 'p7_final', name: 'Final taper' })).toBe('rev')
    expect(phaseKind({ id: 'p8_exam', name: 'Exam window + remaining revision' })).toBe('exam')
  })
  test('task states', () => {
    expect(taskState(t({ status: 'done' }), '2026-10-09')).toBe('done')
    expect(taskState(t({}), '2026-10-09')).toBe('missed')
    expect(taskState(t({ carried_over_from: '2026-10-07' }), '2026-10-08')).toBe('carried')
    expect(taskState(t({ status: 'skipped' }), '2026-10-08')).toBe('skipped')
    expect(taskState(t({}), '2026-10-08')).toBe('todo')
  })
  test('day stats count study minutes only, and flag mock days', () => {
    const d: any = { date: '2026-10-08', tasks: [t({ est_minutes: 60, status: 'done' }), t({ est_minutes: 60 }), t({ type: 'job', est_minutes: 120 }), t({ type: 'mock', est_minutes: 180 })] }
    const s = dayStat(d); expect(s.planned).toBe(300); expect(s.done).toBe(60); expect(s.mock).toBe(true)
    expect(dayStat(undefined).planned).toBe(0)
  })
  test('time order, then plan order', () => {
    const r = byTime([t({ id: 'c', time_block: null, sort: 1 }), t({ id: 'b', time_block: '10:30-11:30', sort: 3 }), t({ id: 'a', time_block: '08:00-10:00', sort: 9 })]).map((x) => x.id)
    expect(r).toEqual(['a', 'b', 'c'])
  })
  test('moving a task updates both day agendas and undo restores its date', () => {
    const days: any = [{ date: '2026-10-08', tasks: [t({ id: 'a' })] }, { date: '2026-10-09', tasks: [] }]
    const moved = updateTaskInDays(days, 'a', { date: '2026-10-09' })
    expect(moved.map((d) => d.tasks.length)).toEqual([0, 1])
    expect(moved[1].tasks[0].date).toBe('2026-10-09')
    expect(updateTaskInDays(moved, 'a', { date: '2026-10-08' }).map((d) => d.tasks.length)).toEqual([1, 0])
    expect(days[0].tasks.length).toBe(1)
  })
  test('start targets and week grouping', () => {
    expect(startTarget(t({ type: 'study', topic_id: 'algo.dp' }), '2026-10-08')).toBe('learn/algo.dp')
    expect(startTarget(t({ type: 'mock' }), '2026-10-08')).toBe('test')
    expect(startTarget(t({ type: 'job' }), '2026-10-08')).toBe('today')
    const w = weeksWithDays([{ start_date: '2026-10-07', end_date: '2026-10-11' }, { start_date: '2026-10-12', end_date: '2026-10-18' }], [{ date: '2026-10-08', tasks: [] }, { date: '2026-10-13', tasks: [] }] as any, '2026-10-10')
    expect(w.length).toBe(1)
  })
})
