import { describe, expect, test } from "bun:test";
import { reschedule, applyToState, dayLoad, capOf, limitOf, type SState, type STask, type SDay } from "../lib/scheduler";

// Week A: Mon 2026-11-02 .. Sun 2026-11-08 ; week B: Mon 2026-11-09 .. Sun 2026-11-15
const A = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const B = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const mkDays = (): SDay[] => [
  ...A.map(date => ({ date, week_id: "wA", available_minutes: null, day_kind: "normal" })),
  ...B.map(date => ({ date, week_id: "wB", available_minutes: null, day_kind: "normal" })),
];
let n = 0;
const task = (date: string, o: Partial<STask> = {}): STask => ({
  id: `t${++n}`, date, sort: n, title: `task ${n}`, type: "study", est_minutes: 60, min_minutes: 30, priority: 2, fixed: 0,
  status: "todo", done_minutes: 0, carry_count: 0, origin_date: null, ...o,
});
const state = (today: string, tasks: STask[], extra: Partial<SState> = {}): SState => ({
  today, days: mkDays(), tasks, weekdayMinutes: 390, weekendMinutes: 300, ...extra,
});
/** fill a day to `mins` with 60-minute priority-2 tasks */
const fill = (date: string, mins: number, o: Partial<STask> = {}) =>
  Array.from({ length: Math.floor(mins / 60) }, () => task(date, o));
const maxLoadRatio = (s: SState, week: string[]) =>
  Math.max(...week.map(d => { const cap = capOf(s.days.find(x => x.date === d)!, s); return cap ? dayLoad(s.tasks, d) / cap : 0; }));

describe("missed day redistribution", () => {
  test("leftovers are carried onto later days, originals marked moved, priority 1 first", () => {
    const monday = [task("2026-11-02", { priority: 3 }), task("2026-11-02", { priority: 1 }), task("2026-11-02", { priority: 2 })];
    const gym = task("2026-11-02", { type: "gym", fixed: 1, est_minutes: 120 });
    const s = state("2026-11-03", [...monday, gym, ...fill("2026-11-03", 300), ...fill("2026-11-04", 300)]);
    const r = reschedule(s, { kind: "missed" });
    const carried = r.changes.filter(c => c.op === "carry");
    expect(carried.length).toBe(3);
    expect(carried[0]!.task_id).toBe(monday[1]!.id); // priority 1 handled first
    expect(r.changes.find(c => c.task_id === gym.id)!.op).toBe("skip"); // fixed never carried
    const next = applyToState(s, r);
    expect(next.tasks.filter(t => t.date === "2026-11-02" && t.status === "todo").length).toBe(0);
    const carries = next.tasks.filter(t => t.id.includes("~"));
    expect(carries.every(t => t.date >= "2026-11-03" && t.carry_count === 1 && t.origin_date === "2026-11-02")).toBe(true);
    expect(r.changes.filter(c => c.op === "carry").every(c => c.to! >= "2026-11-03")).toBe(true);
  });

  test("spreads over days with the most room, not all on one day", () => {
    const left = Array.from({ length: 4 }, () => task("2026-11-02", { est_minutes: 60 }));
    const s = state("2026-11-03", [...left, ...fill("2026-11-03", 300)]);
    const r = reschedule(s, { kind: "missed" });
    const dests = new Set(r.changes.filter(c => c.op === "carry").map(c => c.to));
    expect(dests.size).toBeGreaterThan(1);
  });

  test("no day exceeds 115% capacity; carry-in per day <= 40% of cap", () => {
    const left = Array.from({ length: 12 }, () => task("2026-11-02", { est_minutes: 60 }));
    const base = A.slice(1).flatMap(d => fill(d, d >= "2026-11-07" ? 240 : 360));
    const s = state("2026-11-03", [...left, ...base]);
    const r = reschedule(s, { kind: "missed" });
    const next = applyToState(s, r);
    expect(maxLoadRatio(next, A.slice(1, 7))).toBeLessThanOrEqual(1.15 + 1e-9);
    const carryByDay = new Map<string, number>();
    for (const c of r.changes) if (c.op === "carry" && c.reason !== "overflow: pushed to next week") carryByDay.set(c.to!, (carryByDay.get(c.to!) ?? 0) + c.est_minutes);
    for (const [d, m] of carryByDay) expect(m).toBeLessThanOrEqual(Math.floor(capOf(s.days.find(x => x.date === d)!, s) * 0.4));
  });

  test("overflow goes to the first day of next week and a week note is produced", () => {
    const left = Array.from({ length: 20 }, () => task("2026-11-02", { est_minutes: 60 }));
    const s = state("2026-11-05", [...left, ...A.slice(3).flatMap(d => fill(d, 360))]);
    const r = reschedule(s, { kind: "missed" });
    expect(r.overflow.length).toBeGreaterThan(0);
    expect(r.overflow.every(o => o.to === "2026-11-09")).toBe(true);
    expect(r.week_notes[0]!.line).toMatch(/tasks \(\d+ min\) pushed to next week/);
    // nothing lost: every leftover is accounted for
    const total = r.changes.filter(c => c.op === "carry").reduce((s, c) => s + c.est_minutes, 0);
    expect(total).toBe(20 * 60);
  });

  test("priority-3 task that carried twice is skipped on overflow, not carried forever", () => {
    const stuck = task("2026-11-02", { priority: 3, carry_count: 2 });
    const s = state("2026-11-06", [stuck, ...["2026-11-06", "2026-11-07", "2026-11-08"].flatMap(d => fill(d, 420))]);
    const r = reschedule(s, { kind: "missed" });
    expect(r.changes).toEqual([expect.objectContaining({ op: "skip", task_id: stuck.id })]);
    expect(r.overflow[0]!.action).toBe("skipped");
  });

  test("partly done task carries only the remainder; big study task may split", () => {
    const part = task("2026-11-02", { est_minutes: 90, done_minutes: 30, status: "doing" });
    const big = task("2026-11-02", { est_minutes: 240, priority: 1 });
    const s = state("2026-11-03", [part, big, ...A.slice(1, 6).flatMap(d => fill(d, 360))]);
    const r = reschedule(s, { kind: "missed" });
    expect(r.changes.find(c => c.task_id === part.id)!.est_minutes).toBe(60);
    expect(r.changes.filter(c => c.task_id === big.id).reduce((s, c) => s + c.est_minutes, 0)).toBe(240);
    expect(r.changes.filter(c => c.task_id === big.id).length).toBeGreaterThan(1); // split
  });

  test("done tasks and fixed tasks never move; habit-window days are not redistributed", () => {
    const done = task("2026-11-02", { status: "done" });
    const days = mkDays(); days[0]!.redistribute = false;
    const miss = task("2026-11-02");
    const s = state("2026-11-03", [done, miss], { days });
    const r = reschedule(s, { kind: "missed" });
    expect(r.changes.some(c => c.task_id === done.id)).toBe(false);
    expect(r.changes).toEqual([expect.objectContaining({ op: "skip", task_id: miss.id })]);
  });

  test("idempotent: second run yields zero changes", () => {
    const left = Array.from({ length: 8 }, () => task("2026-11-02", { est_minutes: 60 }));
    const s = state("2026-11-03", [...left, ...A.slice(1).flatMap(d => fill(d, 300))]);
    const r1 = reschedule(s, { kind: "missed" });
    expect(r1.changes.length).toBeGreaterThan(0);
    const s2 = applyToState(s, r1);
    expect(reschedule(s2, { kind: "missed" }).changes).toEqual([]);
    const s3 = applyToState(s2, reschedule(s2, { kind: "rebalance" }));
    expect(reschedule(s3, { kind: "rebalance" }).changes).toEqual([]);
  });
});

describe("rebalance", () => {
  test("brings every day under 115% and never moves done/fixed tasks", () => {
    const heavy = [...fill("2026-11-03", 600, { priority: 3 }), task("2026-11-03", { status: "done", est_minutes: 60 }), task("2026-11-03", { type: "gym", fixed: 1, est_minutes: 120 })];
    const s = state("2026-11-02", [...heavy, ...A.slice(2, 7).flatMap(d => fill(d, 240))]);
    const r = reschedule(s, { kind: "rebalance" });
    const next = applyToState(s, r);
    expect(maxLoadRatio(next, A)).toBeLessThanOrEqual(1.15 + 1e-9);
    expect(next.tasks.find(t => t.type === "gym")!.date).toBe("2026-11-03");
    expect(next.tasks.find(t => t.status === "done")!.date).toBe("2026-11-03");
  });
});

describe("capacity scaling", () => {
  const D = "2026-11-03";
  const day = (extra: STask[] = []) => [
    task(D, { priority: 1, est_minutes: 120, min_minutes: 90 }),
    task(D, { priority: 2, est_minutes: 90, min_minutes: 45 }),
    task(D, { priority: 2, est_minutes: 60, min_minutes: 30, type: "pyq" }),
    task(D, { priority: 3, est_minutes: 60, min_minutes: 30 }),
    ...extra,
  ];

  test("scale down: priority-3 goes first, then shrink; result fits target; p1 untouched", () => {
    const tasks = [...day(), ...["2026-11-04", "2026-11-05", "2026-11-06"].flatMap(d => fill(d, 240))];
    const s = state("2026-11-03", tasks);
    const r = reschedule(s, { kind: "capacity", date: D, minutes: 270 }); // planned 330 -> 270
    const next = applyToState(s, r);
    const open = next.tasks.filter(t => t.date === D && t.status === "todo");
    expect(open.reduce((a, t) => a + t.est_minutes, 0)).toBeLessThanOrEqual(270);
    expect(open.find(t => t.priority === 1)!.est_minutes).toBe(120);
    expect(next.tasks.find(t => t.priority === 3 && t.date !== D)).toBeTruthy(); // moved away
    expect(r.changes.every(c => c.est_minutes % 5 === 0)).toBe(true);
    expect(reschedule(next, { kind: "capacity", date: D, minutes: 270 }).changes).toEqual([]);
  });

  test("scale down hard: shrinks to min, then moves p2, warns when p1 is touched", () => {
    const s = state("2026-11-03", [...day(), ...fill("2026-11-05", 120)]);
    const r = reschedule(s, { kind: "capacity", date: D, minutes: 100 });
    const next = applyToState(s, r);
    const open = next.tasks.filter(t => t.date === D && t.status === "todo");
    expect(open.reduce((a, t) => a + t.est_minutes, 0)).toBeLessThanOrEqual(100 + 20); // p1 min is 90 -> warn
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const t of open) expect(t.est_minutes).toBeGreaterThanOrEqual(t.min_minutes!);
  });

  test("scale up: pulls forward p1/p2 from later days (not mocks, not p3), then extends pyq", () => {
    const later = [
      task("2026-11-04", { priority: 3, est_minutes: 60 }),
      task("2026-11-04", { priority: 1, est_minutes: 90 }),
      task("2026-11-05", { priority: 2, est_minutes: 60 }),
      task("2026-11-05", { type: "mock", priority: 1, est_minutes: 60 }),
    ];
    const s = state("2026-11-03", [...day(), ...later]);
    const r = reschedule(s, { kind: "capacity", date: D, minutes: 480 }); // planned 330, slack 150
    const next = applyToState(s, r);
    const pulled = next.tasks.filter(t => t.date === D && t.origin_date);
    expect(pulled.map(t => t.priority).sort()).toEqual([1, 2]);
    expect(next.tasks.find(t => t.type === "mock")!.date).toBe("2026-11-05");
    expect(next.tasks.find(t => t.priority === 3 && t.est_minutes === 60 && t.id === later[0]!.id)!.date).toBe("2026-11-04");
    expect(pulled.every(t => t.carry_count === 0)).toBe(true);
    const total = next.tasks.filter(t => t.date === D && t.status === "todo").reduce((a, t) => a + t.est_minutes, 0);
    expect(480 - total).toBeLessThan(15 + 1e-9);
    expect(reschedule(next, { kind: "capacity", date: D, minutes: 480 }).changes).toEqual([]);
  });

  test("done minutes count against the new capacity", () => {
    const s = state("2026-11-03", [task(D, { status: "done", done_minutes: 120, est_minutes: 120 }), ...day()]);
    const r = reschedule(s, { kind: "capacity", date: D, minutes: 300 });
    const next = applyToState(s, r);
    expect(next.tasks.filter(t => t.date === D && t.status === "todo").reduce((a, t) => a + t.est_minutes, 0)).toBeLessThanOrEqual(180);
  });
});

test("capacity helpers", () => {
  const s = state("2026-11-03", []);
  expect(capOf({ date: "2026-11-03", week_id: "wA", available_minutes: null, day_kind: "normal" }, s)).toBe(390);
  expect(capOf({ date: "2026-11-07", week_id: "wA", available_minutes: null, day_kind: "normal" }, s)).toBe(300);
  expect(capOf({ date: "2026-11-03", week_id: "wA", available_minutes: null, day_kind: "light" }, s)).toBe(195);
  expect(capOf({ date: "2026-11-03", week_id: "wA", available_minutes: 100, day_kind: "off" }, s)).toBe(0);
  expect(limitOf(390)).toBe(448);
});
