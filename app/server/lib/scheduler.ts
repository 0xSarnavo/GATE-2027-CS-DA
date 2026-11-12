/**
 * Adaptive rescheduling (spec 01 section 6). Pure: no I/O, no clock. The server applies `changes` in one transaction.
 *
 * Capacity model: cap(d) = available_minutes ?? weekday/weekend default; off=0, light=50%.
 * A day may be filled up to LIMIT_FACTOR*cap (115%); carry-ins to one day are limited to CARRY_SHARE*cap (40%).
 */

export const STUDY_TYPES = new Set(["study", "pyq", "revision", "mock", "GA"]);
export const LIMIT_FACTOR = 1.15;
export const CARRY_SHARE = 0.4;
export const SPLITTABLE = new Set(["study", "pyq"]);
export const MIN_CHUNK = 30;

export interface STask {
  id: string; date: string; sort: number; title: string; type: string;
  est_minutes: number; min_minutes: number | null; priority: number; fixed: number;
  status: string; done_minutes: number; carry_count: number; origin_date: string | null;
}
export interface SDay { date: string; week_id: string; available_minutes: number | null; day_kind: string; redistribute?: boolean }
export interface SState {
  today: string;
  days: SDay[];
  tasks: STask[];
  weekdayMinutes: number;
  weekendMinutes: number;
  /** week being rescheduled; default = week of the first day >= today */
  weekId?: string;
  /** id factory for carry tasks (must be deterministic in tests) */
  newId?: (orig: STask, to: string, n: number) => string;
}
export type Trigger =
  | { kind: "missed" }
  | { kind: "rebalance" }
  | { kind: "capacity"; date: string; minutes: number };

export type ChangeOp = "carry" | "move" | "resize" | "skip";
export interface Change {
  op: ChangeOp;
  task_id: string;
  from: string;
  to: string | null;
  est_minutes: number;      // est after the change (for carry: est of the new task)
  prev_est: number;
  reason: string;
  new_task_id?: string;     // carry only
  carry_inc?: 0 | 1;        // move only: whether carry_count increments (pull-forward = 0)
}
export interface Overflow { task_id: string; title: string; est_minutes: number; to: string | null; action: "carried" | "skipped" | "unplaced" }
export interface Result { changes: Change[]; overflow: Overflow[]; warnings: string[]; week_notes: { week_id: string; line: string }[] }

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
const isWeekend = (d: string) => dow(d) === 0 || dow(d) === 6;
const r5 = (n: number) => Math.round(n / 5) * 5;
const f5 = (n: number) => Math.floor(n / 5) * 5;
const isStudy = (t: STask) => !t.fixed && STUDY_TYPES.has(t.type);
const live = (t: STask) => t.status === "todo" || t.status === "doing" || t.status === "done";

export function capOf(d: SDay, s: Pick<SState, "weekdayMinutes" | "weekendMinutes">): number {
  if (d.day_kind === "off") return 0;
  const base = d.available_minutes ?? (isWeekend(d.date) ? s.weekendMinutes : s.weekdayMinutes);
  return d.day_kind === "light" ? Math.round(base * 0.5) : base;
}
export const limitOf = (cap: number) => Math.floor(cap * LIMIT_FACTOR);

/** planned study minutes of a day (todo/doing/done, non-fixed, study types) */
export function dayLoad(tasks: STask[], date: string): number {
  let n = 0;
  for (const t of tasks) if (t.date === date && isStudy(t) && live(t)) n += t.est_minutes;
  return n;
}

/** Apply a Result to a plain state (used by tests; the server has its own SQL applier with the same semantics). */
export function applyToState(state: SState, res: Result): SState {
  const tasks = state.tasks.map(t => ({ ...t }));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const maxSort = (d: string) => tasks.filter(t => t.date === d).reduce((m, t) => Math.max(m, t.sort), 0);
  for (const c of res.changes) {
    const t = byId.get(c.task_id)!;
    if (c.op === "skip") t.status = "skipped";
    else if (c.op === "resize") t.est_minutes = c.est_minutes;
    else if (c.op === "move") {
      t.sort = maxSort(c.to!) + 1; t.date = c.to!; t.origin_date ??= c.from;
      if (c.carry_inc !== 0) t.carry_count += 1;
    } else {
      t.status = "moved";
      const nt: STask = {
        ...t, id: c.new_task_id!, date: c.to!, sort: maxSort(c.to!) + 1, est_minutes: c.est_minutes, status: "todo",
        done_minutes: 0, carry_count: t.carry_count + 1, origin_date: t.origin_date ?? t.date,
        min_minutes: t.min_minutes == null ? null : Math.min(t.min_minutes, c.est_minutes),
      };
      tasks.push(nt); byId.set(nt.id, nt);
    }
  }
  return { ...state, tasks };
}

export function reschedule(state: SState, trigger: Trigger): Result {
  const res: Result = { changes: [], overflow: [], warnings: [], week_notes: [] };
  const days = [...state.days].sort((a, b) => a.date.localeCompare(b.date));
  const dayBy = new Map(days.map(d => [d.date, d]));
  const tasks = state.tasks.map(t => ({ ...t })); // working copy, mutated to track loads
  const today = state.today;

  const firstOnOrAfter = days.find(d => d.date >= today) ?? days[days.length - 1];
  const targetDay = trigger.kind === "capacity" ? dayBy.get(trigger.date) : undefined;
  const weekId = trigger.kind === "capacity" ? targetDay?.week_id : state.weekId ?? firstOnOrAfter?.week_id;
  if (!weekId) return res;
  const weekDays = days.filter(d => d.week_id === weekId);
  const weekLast = weekDays[weekDays.length - 1]?.date ?? today;
  const nextWeekFirst = days.find(d => d.date > weekLast);
  const capOfDay = (d: SDay) => capOf(d, state);

  // running state
  const load = new Map<string, number>();
  for (const d of days) load.set(d.date, dayLoad(tasks, d.date));
  const carryIn = new Map<string, number>();
  let idN = 0;
  const mkId = (t: STask, to: string) => state.newId ? state.newId(t, to, ++idN) : `${t.id}~${to}~${++idN}`;
  const mode: "carry" | "move" = trigger.kind === "missed" ? "carry" : "move";

  const push = (c: Change) => res.changes.push(c);
  const bumpLoad = (date: string, n: number) => load.set(date, (load.get(date) ?? 0) + n);

  /** pick the best landing day for `minutes` of task t, strictly after minDate (exclusive) and >= today */
  function fits(d: SDay, minutes: number): number {
    const cap = capOfDay(d);
    if (cap <= 0 || d.day_kind === "mock") return -1;
    const roomLimit = limitOf(cap) - (load.get(d.date) ?? 0);
    const roomCarry = Math.floor(cap * CARRY_SHARE) - (carryIn.get(d.date) ?? 0);
    return Math.min(roomLimit, roomCarry);
  }
  function candidates(afterDate: string | null): SDay[] {
    return weekDays.filter(d => d.date >= today && (afterDate === null || d.date > afterDate));
  }
  function bestDay(cands: SDay[], minutes: number): SDay | null {
    let best: SDay | null = null, bestFree = -Infinity;
    for (const d of cands) {
      const room = fits(d, minutes);
      if (room < minutes) continue;
      const free = limitOf(capOfDay(d)) - (load.get(d.date) ?? 0);
      if (free > bestFree || (free === bestFree && best && d.date > best.date)) { best = d; bestFree = free; }
    }
    return best;
  }

  /**
   * Relocate `t` (remaining minutes `rem`) within the week after `afterDate`, else overflow to next week.
   * Mutates working loads. `reason` is recorded on the change.
   */
  function relocate(t: STask, rem: number, afterDate: string | null, reason: string, orig: { date: string }): void {
    const cands = candidates(afterDate);
    let remaining = rem;
    let first = true;
    const emit = (to: string, minutes: number, why: string, whole: boolean) => {
      if (mode === "carry") {
        push({ op: "carry", task_id: t.id, from: orig.date, to, est_minutes: minutes, prev_est: t.est_minutes, reason: why, new_task_id: mkId(t, to) });
      } else {
        push({ op: "move", task_id: t.id, from: orig.date, to, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: why, carry_inc: 1 });
      }
      bumpLoad(to, minutes); carryIn.set(to, (carryIn.get(to) ?? 0) + minutes);
      void whole;
    };
    while (remaining > 0) {
      const d = bestDay(cands, remaining);
      if (d) { emit(d.date, remaining, reason, first); remaining = 0; break; }
      // split? (carry mode only; study/pyq; >= 2*MIN_CHUNK)
      if (mode === "carry" && SPLITTABLE.has(t.type) && remaining >= 2 * MIN_CHUNK) {
        let bd: SDay | null = null, br = -1;
        for (const c of cands) { const room = fits(c, 1); if (room > br) { br = room; bd = c; } }
        const chunk = bd ? Math.min(f5(br), f5(remaining - MIN_CHUNK)) : 0;
        if (bd && chunk >= MIN_CHUNK) { emit(bd.date, chunk, reason + " (split)", false); remaining -= chunk; first = false; continue; }
      }
      break;
    }
    if (remaining <= 0) return;
    // overflow to next week
    if (t.priority === 3 && t.carry_count >= 2 && first) {
      push({ op: "skip", task_id: t.id, from: orig.date, to: null, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: "priority-3 carried twice: surfaced in weekly review instead" });
      res.overflow.push({ task_id: t.id, title: t.title, est_minutes: remaining, to: null, action: "skipped" });
      return;
    }
    if (!nextWeekFirst) {
      res.overflow.push({ task_id: t.id, title: t.title, est_minutes: remaining, to: null, action: "unplaced" });
      res.warnings.push(`no next week to carry "${t.title}" into`);
      return;
    }
    const why = "overflow: pushed to next week";
    if (mode === "carry") {
      push({ op: "carry", task_id: t.id, from: orig.date, to: nextWeekFirst.date, est_minutes: remaining, prev_est: t.est_minutes, reason: why, new_task_id: mkId(t, nextWeekFirst.date) });
    } else {
      push({ op: "move", task_id: t.id, from: orig.date, to: nextWeekFirst.date, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: why, carry_inc: 1 });
    }
    res.overflow.push({ task_id: t.id, title: t.title, est_minutes: remaining, to: nextWeekFirst.date, action: "carried" });
  }

  const order = (a: STask, b: STask) =>
    a.priority - b.priority || b.carry_count - a.carry_count || a.date.localeCompare(b.date) || a.sort - b.sort;

  // ---------------- Trigger A ----------------
  if (trigger.kind === "missed") {
    const left = tasks.filter(t => (t.status === "todo" || t.status === "doing") && t.date < today);
    const place: STask[] = [];
    for (const t of left) {
      const d = dayBy.get(t.date);
      if (t.fixed || !STUDY_TYPES.has(t.type)) {
        push({ op: "skip", task_id: t.id, from: t.date, to: null, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: "fixed/non-study task is never carried" });
      } else if (d && d.redistribute === false) {
        push({ op: "skip", task_id: t.id, from: t.date, to: null, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: "missed in a light/off period: not redistributed" });
      } else place.push(t);
    }
    place.sort(order);
    for (const t of place) {
      const rem = Math.max(5, t.est_minutes - (t.done_minutes || 0));
      relocate(t, rem, null, "missed day carry-over", t);
    }
    const pushed = res.overflow.filter(o => o.action === "carried");
    if (pushed.length) {
      const mins = pushed.reduce((s, o) => s + o.est_minutes, 0);
      res.week_notes.push({ week_id: weekId, line: `${pushed.length} tasks (${mins} min) pushed to next week` });
    }
  }

  // ---------------- Trigger C (rebalance) ----------------
  if (trigger.kind === "rebalance") {
    for (const d of weekDays) {
      if (d.date < today) continue;
      const lim = limitOf(capOfDay(d));
      let guard = 500;
      while ((load.get(d.date) ?? 0) > lim && guard-- > 0) {
        const movable = tasks
          .filter(t => t.date === d.date && isStudy(t) && t.status === "todo" && !(t.done_minutes > 0) && t.type !== "mock")
          .sort((a, b) => b.priority - a.priority || b.sort - a.sort);
        const t = movable[0];
        if (!t) { res.warnings.push(`${d.date} is over capacity but nothing movable remains`); break; }
        bumpLoad(d.date, -t.est_minutes);
        t.status = "moved"; // remove from working set so it's not picked again
        relocate(t, t.est_minutes, d.date, "rebalance: day over 115% capacity", { date: d.date });
      }
    }
  }

  // ---------------- Trigger B (capacity) ----------------
  if (trigger.kind === "capacity" && targetDay) {
    const D = targetDay.date;
    const minutes = Math.max(0, Math.round(trigger.minutes));
    const dayTasks = () => tasks.filter(t => t.date === D && isStudy(t));
    const doneToday = dayTasks().filter(t => t.status === "done").reduce((s, t) => s + (t.done_minutes || t.est_minutes), 0);
    const target = Math.max(0, minutes - doneToday);
    const remOf = (t: STask) => (t.status === "doing" ? Math.max(0, t.est_minutes - (t.done_minutes || 0)) : t.est_minutes);
    const open = () => dayTasks().filter(t => t.status === "todo" || t.status === "doing");
    let planned = open().reduce((s, t) => s + remOf(t), 0);

    const resizedFrom = new Map<string, number>();
    const resize = (t: STask, newEst: number, why: string) => {
      const before = remOf(t);
      if (!resizedFrom.has(t.id)) resizedFrom.set(t.id, t.est_minutes);
      push({ op: "resize", task_id: t.id, from: D, to: D, est_minutes: newEst, prev_est: t.est_minutes, reason: why });
      t.est_minutes = newEst;
      planned -= before - remOf(t);
    };
    const evict = (t: STask, why: string) => {
      const orig = resizedFrom.get(t.id);
      if (orig !== undefined) { // moving a task we already shrank: undo the shrink, move it whole
        const i = res.changes.findIndex(c => c.op === "resize" && c.task_id === t.id);
        if (i >= 0) res.changes.splice(i, 1);
        planned += remOf({ ...t, est_minutes: orig }) - remOf(t);
        t.est_minutes = orig; resizedFrom.delete(t.id);
      }
      planned -= remOf(t);
      t.status = "moved";
      relocate(t, t.est_minutes, D, why, { date: D });
    };

    if (planned > target) {
      // 1. priority-3 away (last in order first)
      for (const t of open().filter(t => t.priority === 3 && t.status === "todo").sort((a, b) => b.sort - a.sort)) {
        if (planned <= target) break;
        evict(t, "capacity reduced: priority-3 moved later");
      }
      // 2. shrink p3 then p2 toward min_minutes
      for (const pr of [3, 2]) {
        for (const t of open().filter(t => t.priority === pr && t.min_minutes != null && t.status === "todo").sort((a, b) => b.sort - a.sort)) {
          if (planned <= target) break;
          const over = planned - target;
          const floor = Math.min(t.est_minutes, t.min_minutes!);
          const newEst = Math.max(floor, r5(t.est_minutes - over));
          if (newEst < t.est_minutes) resize(t, newEst, "capacity reduced: shrunk toward minimum");
        }
      }
      // 3. move whole p2 tasks, last in order first
      for (const t of open().filter(t => t.priority === 2 && t.status === "todo").sort((a, b) => b.sort - a.sort)) {
        if (planned <= target) break;
        evict(t, "capacity reduced: priority-2 moved later");
      }
      // 4. priority-1 only as a last resort
      if (planned > target) {
        for (const t of open().filter(t => t.priority === 1 && t.min_minutes != null && t.status === "todo").sort((a, b) => b.sort - a.sort)) {
          if (planned <= target) break;
          const over = planned - target;
          const newEst = Math.max(Math.min(t.est_minutes, t.min_minutes!), r5(t.est_minutes - over));
          if (newEst < t.est_minutes) resize(t, newEst, "capacity below priority-1 load: shrunk to minimum");
        }
        if (planned > target) res.warnings.push(`priority-1 tasks alone need ${planned + doneToday} min but capacity is ${minutes} min`);
        else res.warnings.push("capacity below priority-1 load: priority-1 tasks were shrunk");
      }
    } else if (planned < target) {
      let slack = target - planned;
      // pull forward (earliest day first, priority 1/2, not mocks)
      const later = weekDays.filter(d => d.date > D && d.day_kind !== "mock");
      outer: for (const d of later) {
        const cands = tasks
          .filter(t => t.date === d.date && isStudy(t) && t.status === "todo" && t.priority <= 2 && t.type !== "mock")
          .sort((a, b) => a.priority - b.priority || a.sort - b.sort);
        for (const t of cands) {
          if (slack < 15) break outer;
          if (t.est_minutes > slack) continue;
          push({ op: "move", task_id: t.id, from: t.date, to: D, est_minutes: t.est_minutes, prev_est: t.est_minutes, reason: "capacity increased: pulled forward", carry_inc: 0 });
          bumpLoad(t.date, -t.est_minutes); bumpLoad(D, t.est_minutes);
          t.origin_date ??= t.date; t.date = D; slack -= t.est_minutes;
        }
      }
      // extend pyq/revision up to 1.5x
      if (slack >= 15) {
        for (const t of dayTasks().filter(t => t.status === "todo" && (t.type === "pyq" || t.type === "revision"))) {
          if (slack < 15) break;
          const orig = state.tasks.find(x => x.id === t.id)?.est_minutes ?? t.est_minutes;
          const maxEst = f5(orig * 1.5);
          const newEst = Math.min(maxEst, f5(t.est_minutes + slack));
          if (newEst > t.est_minutes) {
            slack -= newEst - t.est_minutes;
            push({ op: "resize", task_id: t.id, from: D, to: D, est_minutes: newEst, prev_est: t.est_minutes, reason: "capacity increased: extended" });
            t.est_minutes = newEst;
          }
        }
      }
    }
    if (res.overflow.some(o => o.action === "carried")) {
      const pushed = res.overflow.filter(o => o.action === "carried");
      res.week_notes.push({ week_id: weekId, line: `${pushed.length} tasks (${pushed.reduce((s, o) => s + o.est_minutes, 0)} min) pushed to next week` });
    }
  }
  return res;
}
