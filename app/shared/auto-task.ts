/** Interpret the existing human-written plan titles without changing their stored shape. */
export type AutoKind = 'questions' | 'pyq' | 'study' | 'flashcards' | 'mistakes' | 'job' | 'mock' | 'syllabus' | 'gym' | 'other'

const SEEDED_TOPICS: [RegExp, string][] = [
  [/verbal aptitude/i, 'ga.verbal'], [/quantitative aptitude/i, 'ga.quant'],
  [/analytical aptitude/i, 'ga.analytical'], [/spatial aptitude/i, 'ga.spatial'],
  [/python/i, 'ds.python'], [/\bC (?:refresh|pointers|programming)\b|programming in C/i, 'ds.c'],
  [/counting: permutations|permutations and combinations/i, 'prob.counting'],
  [/bayes/i, 'prob.bayes'], [/eigenvalues/i, 'la.eigen'],
]

export function parseTaskTitle(title: string, type = '') {
  const n = /(?:\(|\b)(\d+)\+?\s*(?:(?:easy|hard|new|due|past.paper)\s+){0,2}(?:Qs?|questions?|problems?|snippets?|reviews?)\b/i.exec(title)
  // Ranges use the lower bound, so "8-10 Qs" is achievable at eight.
  const range = /\b(\d+)\s*[-–]\s*(\d+)\s*(?:Qs?|questions?)\b/i.exec(title)
  const count = range ? Number(range[1]) : n ? Number(n[1]) : null
  const lower = title.toLowerCase()
  let kind: AutoKind = 'other'
  if (type === 'gym' || /\bgym\b/i.test(title)) kind = 'gym'
  else if (type === 'job' || /job hunt|job tracker|portfolio project/i.test(title)) kind = 'job'
  else if (/syllabus walk/i.test(title)) kind = 'syllabus'
  else if (/flashcards?|\bcards? due\b/i.test(title)) kind = 'flashcards'
  else if (/mistakes?|error.log/i.test(title) && type === 'revision') kind = 'mistakes'
  else if (type === 'mock' || /diagnostic|full (?:cs|da) paper|timed sectional/i.test(title)) kind = 'mock'
  else if (type === 'pyq' || /\bpyqs?\b|past.paper/i.test(title)) kind = 'pyq'
  else if (count) kind = 'questions'
  else if (type === 'study' || /^(?:study|foundation|review):/i.test(title)) kind = 'study'
  const topic_id = SEEDED_TOPICS.find(([re]) => re.test(title))?.[1] ?? null
  return { kind, count, topic_id, isFoundation: /foundation/i.test(lower) }
}
