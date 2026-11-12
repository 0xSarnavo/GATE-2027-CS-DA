import { addDays, diffDays } from "../util";

export interface StreakResult { current: number; longest: number; today_done: boolean }
export interface StreakOpts { weekdaysOnly?: boolean; freezePerDays?: number }

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
const isWeekend = (d: string) => dow(d) === 0 || dow(d) === 6;

/**
 * Consecutive qualifying days ending today (or yesterday if today isn't done yet).
 * weekdaysOnly: weekends are skipped (neither break nor extend).
 * One-day freeze per 7 days: a single missed day does not break the streak if no freeze was used in the previous 7 days.
 */
export function computeStreak(qualifies: (date: string) => boolean, from: string, today: string, opts: StreakOpts = {}): StreakResult {
  const freezeGap = opts.freezePerDays ?? 7;
  let cur = 0, longest = 0, lastFreeze = -1e9;
  const todayDone = qualifies(today) && !(opts.weekdaysOnly && isWeekend(today));
  const n = diffDays(from, today);
  for (let i = 0; i <= n; i++) {
    const d = addDays(from, i);
    if (opts.weekdaysOnly && isWeekend(d)) continue;
    if (d === today && !todayDone) break; // today not over yet
    if (qualifies(d)) { cur++; longest = Math.max(longest, cur); }
    else if (cur > 0 && i - lastFreeze >= freezeGap) { lastFreeze = i; }
    else cur = 0;
  }
  return { current: cur, longest, today_done: todayDone };
}
