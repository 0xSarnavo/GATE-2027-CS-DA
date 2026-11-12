import { expect, test } from "bun:test";
import { sm2, gameGrade } from "../lib/sm2";
import { grade } from "../lib/grading";
import { computeStreak } from "../lib/streaks";

const fresh = { ease: 2.5, interval_d: 0, reps: 0, lapses: 0 };

test("sm2 interval ladder 1d, 6d, then ease multiples", () => {
  let s = sm2(fresh, 4); expect(s.interval_d).toBe(1); expect(s.reps).toBe(1);
  s = sm2(s, 4); expect(s.interval_d).toBe(6);
  s = sm2(s, 4); expect(s.interval_d).toBe(Math.round(6 * s.ease / 1)); // ease unchanged by grade 4 (+0.1-0.1*... =0)
});
test("sm2 ease formula and floor", () => {
  expect(sm2(fresh, 5).ease).toBeCloseTo(2.6, 5);
  expect(sm2(fresh, 4).ease).toBeCloseTo(2.5, 5);
  expect(sm2(fresh, 3).ease).toBeCloseTo(2.36, 5);
  let s = { ...fresh, reps: 3, interval_d: 10, ease: 1.35 };
  expect(sm2(s, 3).ease).toBe(1.3);
});
test("sm2 lapse resets reps and interval, ease untouched", () => {
  const s = sm2({ ease: 2.2, interval_d: 20, reps: 5, lapses: 1 }, 2);
  expect(s).toMatchObject({ reps: 0, interval_d: 1, lapses: 2, ease: 2.2 });
  expect(() => sm2(fresh, 6)).toThrow();
});
test("game grades", () => {
  expect(gameGrade("match", true)).toBe(4); expect(gameGrade("match", false)).toBe(1);
  expect(gameGrade("recall", true, 1500)).toBe(5); expect(gameGrade("recall", true, 5000)).toBe(4); expect(gameGrade("recall", true, 9000)).toBe(3);
});

test("grading", () => {
  expect(grade({ type: "MCQ", answer: "B" }, "b")).toBe(true);
  expect(grade({ type: "MCQ", answer: "B" }, "A")).toBe(false);
  expect(grade({ type: "MSQ", answer: "A,C" }, "C,A")).toBe(true);
  expect(grade({ type: "MSQ", answer: "A,C" }, "A")).toBe(false);
  expect(grade({ type: "NAT", answer: "12.4..12.6" }, "12.5")).toBe(true);
  expect(grade({ type: "NAT", answer: "12.4..12.6" }, "12.7")).toBe(false);
  expect(grade({ type: "NAT", answer: "0.25" }, "0.25")).toBe(true);
  expect(grade({ type: "NAT", answer: "1..2|5..6" }, "5.5")).toBe(true);
  expect(grade({ type: "MCQ", answer: "" }, "A")).toBeNull();
});

test("streak: consecutive days, today-not-done grace, freeze, weekdays only", () => {
  const set = (...d: string[]) => (x: string) => d.includes(x);
  // 3 days ending yesterday, today not done: still 3
  let s = computeStreak(set("2026-11-02", "2026-11-03", "2026-11-04"), "2026-11-01", "2026-11-05");
  expect(s).toEqual({ current: 3, longest: 3, today_done: false });
  // today done extends
  s = computeStreak(set("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"), "2026-11-01", "2026-11-05");
  expect(s.current).toBe(4); expect(s.today_done).toBe(true);
  // one gap is frozen, two gaps within 7 days break
  s = computeStreak(set("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05"), "2026-11-01", "2026-11-05");
  expect(s.current).toBe(4);
  s = computeStreak(set("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06"), "2026-11-01", "2026-11-06");
  expect(s.current).toBe(1);
  // weekends skipped for job streak (Sat 7th, Sun 8th)
  s = computeStreak(set("2026-11-05", "2026-11-06", "2026-11-09"), "2026-11-05", "2026-11-09", { weekdaysOnly: true });
  expect(s.current).toBe(3);
});
