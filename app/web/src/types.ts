export type Scope = 'shared' | 'cs' | 'da' | 'ga' | 'foundation'
export interface Task {
  id: string; date: string; title: string; type: string
  subject_id?: string | null; topic_id?: string | null
  est_minutes: number; min_minutes?: number | null; priority: number; fixed?: number | boolean
  status: 'todo' | 'doing' | 'done' | 'skipped' | 'moved'
  done_minutes?: number; carried_over_from?: string | null; carry_count?: number
  time_block?: string | null; sort?: number
  auto_done?: number | boolean; auto_reason?: string | null; target_topic_id?: string | null; task_kind?: string
}
export interface Day { date: string; available_minutes?: number | null; day_kind?: string; note?: string; tasks: Task[] }
export interface Goal { id?: string; text: string; done?: boolean; metric?: string; target?: number; current?: number; progress?: number }
export interface Week { id: string; phase_id?: string; week_no: number; start_date: string; end_date: string; title?: string; macro_goals: Goal[]; review_notes?: string }
export interface Phase { id: string; name: string; start_date: string; end_date: string; description?: string }
export interface Streak { current: number; longest?: number; today_done?: boolean }
export interface Today {
  date: string; day: Day | null; phase?: Phase; week?: Week
  done_minutes?: number
  questions_done?: number; daily_question_goal?: number
  due: { cards: number; mistakes: number }
  streaks: Record<string, Streak>
  missed?: { revision_id: string; at: string; moved: number; skipped: number; undone?: boolean } | null
}
export interface Topic {
  id: string; name: string; parent_id: string | null; scope: Scope; subject_id?: string
  question_count?: number
  progress?: { status?: string; confidence?: number | null; questions_done?: number; questions_correct?: number }
}
export interface Q {
  id: string; source: string; paper?: string; year?: number; session?: string; q_no?: string | number
  topic_id: string; type: 'MCQ' | 'MSQ' | 'NAT'; marks: number; stem: string
  options: { key: string; text: string }[]; answer: string; difficulty: number; order_in_topic?: number
  quick_method?: string; solution?: string; explanation?: string; trap_note?: string
  video_url?: string; video_start_s?: number; images: string[]; needs_review: boolean; garbled?: boolean
  /** ADHD layers: base fields are Focus (short); *_full is the detailed version (absent => same text). */
  quick_method_full?: string; solution_full?: string; explanation_full?: string; trap_note_full?: string
  level?: number; hints: string[]; atoms: string[]
  answer_check?: 'agrees' | 'disagrees' | 'unsure'; answer_check_note?: string; answer_source?: string
  outside_syllabus: boolean; pre2017: boolean; remote_images: boolean; syllabus_note?: string; discussion_url?: string; has_key: boolean
}
export interface Blueprint {
  topic_id: string; summary_md: string | null; summary_full_md: string | null
  atoms: { id: string; name: string; one_line: string }[] | null
  patterns: { name: string; years?: string[]; freq?: number; note?: string }[] | null
  traps: string[] | null; hardest_pyq: string | null
}
export interface Mistake { id: string; question_id: string; stage: number; due_on: string; error_type?: string; status: string; question?: Q }
export interface Card {
  id: string; topic_id?: string | null; kind: string; front: string; back: string; hint?: string
  ease?: number; interval_d?: number; reps?: number; due_on?: string; tags?: string[]
}
export type ErrorType = 'concept' | 'calculation' | 'reading' | 'time' | 'guess'

export interface Concept { topic_id: string; atom_id: string; name: string; one_line: string; has_card: boolean }
export type TestKind = 'quick' | 'topic' | 'pyq' | 'mock'
export interface TestSession { id: string; kind: TestKind; scope: any; allowed_s: number; max_score: number; short?: boolean; questions: Q[] }
export interface ChapterRes { id: string; name: string; total: number; attempted: number; correct: number; score: number; max: number; accuracy: number | null; lost?: number; subject_id?: string }
export interface TestResult {
  id: string; kind: TestKind; mock_id?: string | null; score: number; max_score: number; attempted: number; correct: number; wrong: number; unattempted: number; accuracy: number; duration_s: number; allowed_s: number
  by_subject: ChapterRes[]; by_chapter: ChapterRes[]; weak: ChapterRes[]
  per_question: { question_id: string; pos: number; topic_id: string; marks: number; type: string; given_answer: string | null; correct: boolean | null; marks_awarded: number; time_s: number; correct_answer: string; marked: boolean; attempt_id?: string | null }[]
}
