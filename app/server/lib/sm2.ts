export interface CardState { ease: number; interval_d: number; reps: number; lapses: number }
export interface Sm2Result extends CardState { due_in_days: number }

/** SM-2 per spec: grade<3 -> reps=0, interval=1, lapses++ (ease unchanged). Else reps 0->1d, 1->6d, n->round(interval*ease); ease adjusted. */
export function sm2(state: CardState, grade: number): Sm2Result {
  if (!(grade >= 0 && grade <= 5)) throw new Error("grade must be 0..5");
  let { ease, interval_d, reps, lapses } = state;
  if (grade < 3) {
    reps = 0; interval_d = 1; lapses += 1;
  } else {
    if (reps === 0) interval_d = 1;
    else if (reps === 1) interval_d = 6;
    else interval_d = Math.round(interval_d * ease);
    reps += 1;
    ease = Math.max(1.3, ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  }
  return { ease: Math.round(ease * 1000) / 1000, interval_d, reps, lapses, due_in_days: interval_d };
}

/** Map game results to an SM-2 grade (match: 4/1; recall: by response time 5/4/3, wrong=1). */
export function gameGrade(mode: string, correct: boolean, timeMs?: number | null): number {
  if (!correct) return 1;
  if (mode === "recall" && timeMs != null) return timeMs < 3000 ? 5 : timeMs < 7000 ? 4 : 3;
  return 4;
}
