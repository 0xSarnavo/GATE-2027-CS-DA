import { goalProgress } from './goal-progress'

export function GoalRings({ minutes, minuteGoal, questions, questionGoal }: { minutes: number; minuteGoal: number; questions: number; questionGoal: number }) {
  const p = goalProgress(minutes, minuteGoal, questions, questionGoal)
  const circle = (radius: number, value: number, color: string) => <>
    <circle cx="38" cy="38" r={radius} fill="none" stroke="var(--track)" stroke-width="6" />
    <circle cx="38" cy="38" r={radius} fill="none" stroke={color} stroke-width="6" stroke-linecap="round" stroke-dasharray={`${2 * Math.PI * radius * value} ${2 * Math.PI * radius}`} transform="rotate(-90 38 38)" />
  </>
  return <div class="goal-rings" role="img" aria-label={`${Math.round(p.study * 100)}% study goal${questionGoal ? `, ${Math.round(p.practice * 100)}% question goal` : ''}`}>
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">{circle(32, p.study, p.reached ? 'var(--gold)' : 'var(--orange)')}{questionGoal > 0 && circle(23, p.practice, p.reached ? 'var(--gold)' : 'var(--text)')}</svg>
    <b>{Math.round(p.combined * 100)}%</b>
  </div>
}
