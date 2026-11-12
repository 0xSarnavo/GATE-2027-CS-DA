export function goalProgress(minutes: number, minuteGoal: number, questions: number, questionGoal: number) {
  const study = minuteGoal > 0 ? Math.min(1, minutes / minuteGoal) : 0
  const practice = questionGoal > 0 ? Math.min(1, questions / questionGoal) : 0
  const reached = study >= 1 && (questionGoal === 0 || practice >= 1)
  return { study, practice, combined: questionGoal ? (study + practice) / 2 : study, reached }
}
