// ALL backend calls live here. Paths are relative to /api. Adjust here if the server differs.
import { kv, enqueue, drain, setSync, syncState, initOutbox, type OutboxItem } from './store'
import { arr, today, uuid7, addDays } from './util'
import type { Q, Blueprint, Task, Topic, Today, Day, Week, Phase, Mistake, Card, Scope, ErrorType, Concept, TestSession, TestResult, TestKind } from './types'

export const MOCK = !!import.meta.env.VITE_MOCK

export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}

let onUnauth: () => void = () => {}
export const setUnauthHandler = (f: () => void) => { onUnauth = f }

async function request(method: string, path: string, body?: unknown, idem?: string): Promise<any> {
  if (MOCK) { const m = await import('./mock'); return m.handle(method, path, body) }
  const headers: Record<string, string> = { 'X-Requested-With': 'app' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 401 && path !== '/auth/login') { onUnauth(); throw new ApiError(401, 'Not signed in') }
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = j?.error?.message || msg } catch { /* */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return null
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

/** Network-first GET; result cached in IndexedDB; falls back to the cache when offline/slow. */
export async function get<T = any>(path: string): Promise<T> {
  try {
    const r = await withTimeout(request('GET', path), 9000)
    kv.set('c:' + path, r); setSync({ offline: false }); return r
  } catch (e) {
    if (e instanceof ApiError) throw e
    setSync({ offline: true })
    const c = await kv.get<T>('c:' + path)
    if (c !== undefined) return c
    throw e
  }
}
export const peek = <T = any,>(path: string) => kv.get<T>('c:' + path)
export const patchCache = async <T,>(path: string, fn: (v: T) => T) => {
  const c = await kv.get<T>('c:' + path); if (c !== undefined) kv.set('c:' + path, fn(c))
}

export interface Queued { queued: true }
/** Write that goes to the outbox when offline. Returns server JSON, or {queued:true}. */
export async function write<T = any>(method: string, path: string, body?: unknown): Promise<T | Queued> {
  const idem = uuid7() // the same key is reused if the write has to be queued, so a replay after a lost response is deduplicated server-side
  if (syncState().offline || syncState().queued > 0) {
    await enqueue(method, path, body, idem); void flush().catch(e => setSync({ error: String(e) })); return { queued: true }
  }
  try { const r = await request(method, path, body, idem); setSync({ offline: false }); return r }
  catch (e) {
    if (e instanceof ApiError) throw e
    setSync({ offline: true }); await enqueue(method, path, body, idem); return { queued: true }
  }
}
export const isQueued = (r: any): r is Queued => !!r && r.queued === true

export async function flush() {
  try { await drain(async (it: OutboxItem) => {
    try { await request(it.method, it.path, it.body, it.id); setSync({ offline: false }); return 'ok' }
    catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status >= 500 || e.status === 429 || e.status === 408) return 'retry'
        return { failed: `${e.status}: ${e.message}` }
      }
      setSync({ offline: true }); return 'retry'
    }
  }) } catch (e) { setSync({ error: `Offline storage unavailable: ${String(e)}` }) }
}

// ---------- normalizers (tolerate seed-style and DB-style field names) ----------
const parseJ = (v: any, d: any) => { if (typeof v !== 'string') return v ?? d; try { return JSON.parse(v) } catch { return d } }
export function imgUrl(ref: string): string {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('/')) return ref
  if (ref.startsWith('media/')) return '/' + ref
  if (ref.startsWith('img/')) return '/media/' + ref
  return '/media/img/' + ref
}
function normAnswer(a: any): string {
  if (Array.isArray(a)) return a.join(',')
  if (a && typeof a === 'object' && Array.isArray(a.ranges)) return a.ranges.map((r: number[]) => (r[0] === r[1] ? String(r[0]) : `${r[0]}..${r[1]}`)).join('|')
  return String(a ?? '')
}
export function normQ(r: any): Q {
  let opts = parseJ(r.options, []) as any[]
  opts = (opts || []).map((o, i) => typeof o === 'string' ? { key: String.fromCharCode(65 + i), text: o } : { key: o.key ?? String.fromCharCode(65 + i), text: o.text ?? '' })
  let imgs = parseJ(r.image_refs, []) as string[]
  if ((!imgs || !imgs.length) && r.image) imgs = [r.image]
  return {
    id: r.id, source: r.source ?? (r.exam_year ? 'official' : 'generated'), paper: r.paper, year: r.year ?? r.exam_year,
    session: r.session, q_no: r.q_no, topic_id: r.topic_id, type: r.type ?? r.q_type ?? 'MCQ', marks: Number(r.marks ?? 1),
    stem: r.stem ?? r.text ?? '', options: opts, answer: normAnswer(r.answer), difficulty: Number(r.difficulty ?? 3),
    order_in_topic: r.order_in_topic, quick_method: r.quick_method || undefined, solution: r.solution || undefined,
    explanation: r.explanation || undefined, trap_note: r.trap_note || undefined,
    video_url: r.video_url || undefined, video_start_s: r.video_start_s || undefined,
    images: (imgs || []).map(imgUrl), needs_review: !!r.needs_review, garbled: r.text_quality === 'garbled-see-image',
    quick_method_full: r.quick_method_full || undefined, solution_full: r.solution_full || undefined,
    explanation_full: r.explanation_full || undefined, trap_note_full: r.trap_note_full || undefined,
    level: r.level || undefined, hints: (parseJ(r.hints, []) || []).map(String), atoms: (parseJ(r.atoms, []) || []).map(String),
    answer_check: r.answer_check || undefined, answer_check_note: r.answer_check_note || undefined, answer_source: r.answer_source || undefined,
    pre2017: (r.source ?? 'official') === 'official' && Number(r.year ?? r.exam_year ?? 9999) < 2017, remote_images: (imgs || []).some((x: string) => /^https?:/.test(x)),
    outside_syllabus: r.in_2027_syllabus === 0 || r.in_2027_syllabus === false, syllabus_note: r.syllabus_note || undefined,
    discussion_url: r.discussion_url || undefined, has_key: normAnswer(r.answer) !== '',
  }
}
const normTopic = (t: any, roots: Map<string, string>): Topic => ({
  ...t, scope: ((t.scope ?? t.paper ?? 'shared') as string).toLowerCase() as Scope, parent_id: t.parent_id ?? null,
  subject_id: t.subject_id ?? roots.get(t.id) ?? t.id,
  progress: t.progress ?? (t.questions_done !== undefined ? { questions_done: t.questions_done, questions_correct: t.questions_correct, status: t.status, confidence: t.confidence } : undefined),
})
const normTask = (t: any, date?: string): Task => ({
  ...t, date: t.date ?? date, est_minutes: t.est_minutes ?? t.minutes ?? 30, status: t.status ?? 'todo',
  subject_id: t.subject_id ?? t.subject ?? null, fixed: t.fixed ? 1 : 0,
})
const normDay = (d: any): Day => ({ ...d, tasks: (d.tasks || []).map((t: any) => normTask(t, d.date)) })
const normWeek = (w: any, i = 0): Week => ({
  ...w, id: w.id ?? `w${w.week_no ?? i}`, start_date: w.start_date ?? w.start, end_date: w.end_date ?? w.end,
  title: w.title ?? w.label, macro_goals: parseJ(w.macro_goals, []) || [], week_no: w.week_no ?? i + 1,
})
const normPhase = (p: any): Phase => ({ ...p, start_date: p.start_date ?? p.start, end_date: p.end_date ?? p.end })

// ---------- auth / meta ----------
const SIGNED_OUT = 'gate.signed-out'
export const locallySignedOut = () => { try { return localStorage.getItem(SIGNED_OUT) === '1' } catch { return false } }
export async function login(password: string) { const result = await request('POST', '/auth/login', { password }); try { localStorage.removeItem(SIGNED_OUT) } catch { /* storage unavailable */ } return result }
export const logout = () => request('POST', '/auth/logout')
export async function me() {
  const r = await request('GET', '/me')
  if (r?.today) (await import('./util')).setToday(r.today)
  return r
}
export async function getSettings(): Promise<Record<string, any>> {
  const r = await get('/settings'); return r?.settings ?? r ?? {}
}
export const patchSettings = (p: Record<string, any>) => write('PATCH', '/settings', p)
export interface SearchResults {
  chapters: { id: string; name: string; parent_id: string | null }[]
  concepts: { topic_id: string; atom_id: string; name: string; snippet: string; topic_name: string }[]
  questions: { id: string; topic_id: string; snippet: string; topic_name: string }[]
}
export const search = (q: string) => get<SearchResults>('/search?q=' + encodeURIComponent(q))

// ---------- plan ----------
export async function getToday(): Promise<Today> {
  const r = await get('/plan/today')
  if (syncState().offline && r.date !== today()) {
    const plan = await kv.get<PlanData>('plan:full')
    const date = today(), day = plan?.days.find(d => d.date === date) ?? null
    const week = plan?.weeks.find(w => w.start_date <= date && date <= w.end_date)
    return { date, day, week, phase: plan?.phases.find(p => p.id === week?.phase_id), due: r.due ?? { cards: 0, mistakes: 0 }, streaks: r.streaks ?? {}, missed: null,
      done_minutes: day?.tasks.reduce((n, t) => n + (t.status === 'done' ? t.done_minutes || t.est_minutes : t.done_minutes || 0), 0) ?? 0,
      questions_done: 0, daily_question_goal: r.daily_question_goal ?? 30 }
  }
  const day = r.day ? normDay(r.day) : null
  const date = r.date ?? day?.date ?? today()
  if (day) day.date = date
  return {
    date, day, phase: r.phase ? normPhase(r.phase) : undefined, week: r.week ? normWeek(r.week) : undefined,
    due: { cards: r.due?.cards ?? 0, mistakes: r.due?.mistakes ?? 0 }, streaks: r.streaks ?? {}, missed: r.missed_banner ?? null,
    done_minutes: r.done_minutes ?? 0, questions_done: r.questions_done ?? 0, daily_question_goal: r.daily_question_goal ?? 30,
  }
}
export interface PlanData { phases: Phase[]; weeks: Week[]; days: Day[] }
export async function getPlan(from?: string, to?: string): Promise<PlanData> {
  const q = from ? `?from=${from}&to=${to ?? addDays(from, 14)}` : ''
  const r = await get('/plan' + q)
  return { phases: (r.phases || []).map(normPhase), weeks: (r.weeks || []).map(normWeek), days: (r.days || []).map(normDay) }
}
/** Whole plan window for the Plan screen (cached for offline). */
export async function getFullPlan(): Promise<PlanData> {
  const weeks = arr<any>(await get('/plan/weeks'))
  const plan = await (weeks.length ? getPlan(weeks[0].start_date, weeks.at(-1)!.end_date) : getPlan())
  await kv.set('plan:full', plan)
  return plan
}
export const undoRevision = (id: string) => request('POST', `/plan/revisions/${id}/undo`)
export const completeTask = (id: string, done_minutes?: number) => write('POST', `/plan/tasks/${id}/complete`, done_minutes ? { done_minutes } : {})
export const patchTask = (id: string, p: Partial<Task>) => write('PATCH', `/plan/tasks/${id}`, p)
export const addTask = (t: Partial<Task>) => write('POST', '/plan/tasks', t)
export const setCapacity = (date: string, minutes: number) => write('POST', `/plan/days/${date}/capacity`, { minutes })
export const reschedule = (week_start: string, dry_run: boolean) => request('POST', '/plan/reschedule', { trigger: 'rebalance', week_start, dry_run })
export const patchWeek = (id: string, p: Partial<Week>) => write('PATCH', `/plan/weeks/${id}`, p)

// ---------- topics / questions ----------
export async function getTopics(): Promise<Topic[]> {
  const r = arr<any>(await get('/topics'))
  const byId = new Map(r.map((t) => [t.id, t]))
  const roots = new Map<string, string>()
  const root = (t: any): string => { let c = t, n = 0; while (c.parent_id && byId.has(c.parent_id) && n++ < 9) c = byId.get(c.parent_id); return c.id }
  r.forEach((t) => roots.set(t.id, root(t)))
  return r.map((t) => normTopic(t, roots))
}
export const putTopicProgress = (id: string, p: object) => write('PUT', `/topics/${id}/progress`, p)
export interface Prereq { id: string; kind: 'foundation' | 'chapter'; name: string; status: string | null; concept_total: number; got_it: number; mastery: number | null; ready: boolean }
export interface Prereqs { chapter_id: string; foundations: Prereq[]; chapters: Prereq[] }
export interface ReadinessResult { chapter_id: string; correct: number; total: number; prerequisites: { id: string; correct: number; total: number; ready: boolean }[]; questions: { id: string; tests: string; correct: boolean; given: string; answer: string | number; explain: string }[]; submitted_at: string }
export interface Readiness { chapter_id: string; available: boolean; questions: { id: string; stem: string; type: 'MCQ' | 'NAT'; options?: (string | { key: string; text: string })[]; tests: string }[]; latest: ReadinessResult | null }
export const getPrereqs = (id: string) => get<Prereqs>(`/topics/${encodeURIComponent(id)}/prereqs`)
export const getReadiness = (id: string) => get<Readiness>(`/readiness/${encodeURIComponent(id)}`)
export const submitReadiness = (id: string, answers: Record<string, string>) => write<ReadinessResult>('POST', `/readiness/${encodeURIComponent(id)}/submit`, { answers })
export async function getBlueprint(topic_id: string): Promise<Blueprint | null> {
  const r = await get<Blueprint>(`/topics/${encodeURIComponent(topic_id)}/blueprint`)
  return r && (r.summary_md || r.atoms || r.patterns || r.traps) ? r : null
}
export async function getExplainer(topic_id: string): Promise<any | null> {
  const r = await get(`/topics/${encodeURIComponent(topic_id)}/explainer`)
  return r?.cards?.length ? r : null
}
export const getVideos = async (topic_id: string) => arr<any>(await get(`/videos?topic_id=${encodeURIComponent(topic_id)}`))
export const getVideoChapter = (topic_id: string) => get<any>(`/videos/chapter?topic_id=${encodeURIComponent(topic_id)}`)
export const getVideosForConcept = (topic_id: string, atom_id: string) => get<any>(`/videos/concept?topic_id=${encodeURIComponent(topic_id)}&atom_id=${encodeURIComponent(atom_id)}`)
export const getVideoCourse = (subject_id: string) => get<any>(`/videos/course?subject_id=${encodeURIComponent(subject_id)}`)
export const getVideoProgress = () => get<any>('/videos/progress')
export const putVideoProgress = (video_id: string, position_s: number, completed?: boolean) => write('PUT', '/videos/progress', { video_id, position_s, ...(completed === undefined ? {} : { completed }) })

let bank: Promise<Q[]> | null = null
/** Entire question bank (all pages), cached in IndexedDB; topic/filters are applied locally so it works offline. */
export function getBank(force = false): Promise<Q[]> {
  if (bank && !force) return bank
  bank = (async () => {
    try {
      const out: any[] = []; let cursor: string | null = null
      do {
        const r: any = await withTimeout(request('GET', `/questions?limit=1000&order=difficulty${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`), 20000)
        out.push(...arr(r)); cursor = r?.next ?? null
      } while (cursor)
      const qs = out.map(normQ); kv.set('bank', qs); setSync({ offline: false }); return qs
    } catch (e) {
      if (e instanceof ApiError) throw e
      setSync({ offline: true })
      const c = await kv.get<Q[]>('bank'); if (c) return c
      throw e
    }
  })()
  bank.catch(() => { bank = null })
  return bank
}
export async function getQuestion(id: string): Promise<Q> {
  try { const b = await getBank(); const q = b.find((x) => x.id === id); if (q) return q } catch { /* fall through */ }
  const r = await get(`/questions/${id}`); return normQ(r.question ?? r)
}
export const flagQuestion = (id: string) => write('PATCH', `/questions/${id}`, { needs_review: 1 })

export interface AttemptRec { question_id: string; correct: boolean; at: string }
export async function getAttempts(): Promise<Map<string, AttemptRec>> {
  const m = new Map<string, AttemptRec>()
  try {
    const out: any[] = []; let cursor: string | null = null
    do { const r: any = await get(`/attempts?limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`); out.push(...arr(r)); cursor = r?.next ?? null } while (cursor)
    for (const a of out) { const p = m.get(a.question_id); if (!p || a.at > p.at) m.set(a.question_id, { question_id: a.question_id, correct: !!a.correct, at: a.at }) }
  } catch { /* offline: only local ones */ }
  const local = (await kv.get<AttemptRec[]>('attempts:local')) || []
  for (const a of local) { const p = m.get(a.question_id); if (!p || a.at > p.at) m.set(a.question_id, a) }
  return m
}
export interface AttemptIn { question_id: string; given_answer: string; time_s: number; error_type?: ErrorType; correct: boolean; used_hint?: boolean; self_graded?: boolean }
/** Posts once, immediately (queued if offline). Returns the client-generated attempt id so error_type can be PATCHed after. */
export async function postAttempt(a: AttemptIn): Promise<string> {
  const at = new Date().toISOString(), id = uuid7()
  const local = (await kv.get<AttemptRec[]>('attempts:local')) || []
  local.push({ question_id: a.question_id, correct: a.correct, at }); await kv.set('attempts:local', local.slice(-1500))
  const { correct, self_graded, ...body } = a
  await write('POST', '/attempts', { id, ...body, ...(self_graded ? { correct } : {}), mode: 'practice', at })
  return id
}
export const patchAttempt = (id: string, p: { error_type?: ErrorType; notes?: string; used_hint?: boolean }) => write('PATCH', `/attempts/${id}`, p)
export const getMistakes = async (due = true, status: 'open'|'all' = 'open'): Promise<Mistake[]> => {
  const r = arr<any>(await get(`/mistakes?due=${due ? 'today' : 'all'}&status=${status}`))
  return r.map((m) => ({ ...m, question: m.question ? normQ(m.question) : undefined }))
}
export const reviewMistake = (id: string, correct: boolean) => write('POST', `/mistakes/${id}/review`, { correct })

// ---------- cards ----------
export const getDueCards = async (limit = 30, topic_id?: string): Promise<Card[]> =>
  arr<Card>(await get(`/cards/due?limit=${limit}${topic_id ? '&topic_id=' + topic_id : ''}`))
export const getCards = async (topic_id?: string): Promise<Card[]> =>
  arr<Card>(await get(`/cards?limit=1000${topic_id ? '&topic_id=' + topic_id : ''}`))
export const reviewCard = (id: string, grade: number, time_ms?: number, mode = 'review') =>
  write('POST', `/cards/${id}/review`, { grade, time_ms, mode, at: new Date().toISOString(), review_id: uuid7() })
export const addCard = (c: Partial<Card>) => write('POST', '/cards', c)
export const postScore = (s: object) => write('POST', '/games/scores', s)

// ---------- log ----------
/** One day: selected minutes plus any explicit manual subject overrides. */
export async function getCheckin(date: string) {
  const r = await get(`/checkins/${date}`)
  const auto: Record<string, number> = {}, manual: Record<string, number> = {}
  for (const x of r.study_minutes ?? []) if (x.source === 'manual') manual[x.subject_id] = x.minutes
  for (const x of r.effective_study_minutes ?? []) if (x.source !== 'manual') auto[x.subject_id] = x.minutes
  return { ...(r.checkin ?? {}), exists: !!r.checkin, auto_minutes: auto, manual_minutes: manual,
    study_minutes_total: r.study_minutes_total ?? 0, job_minutes: r.job_minutes ?? 0, job_counts: r.job_counts ?? { applications: 0, outreach: 0 } }
}
export const getSubjects = async (): Promise<{ id: string; name: string; scope: string }[]> => arr<any>(await get('/subjects')).filter((s: any) => s.id !== 'general')
export const getCheckins = async (from: string, to: string) => arr<any>(await get(`/checkins?from=${from}&to=${to}`))
export const putCheckin = (date: string, body: object) => write('PUT', `/checkins/${date}`, body)
export const getMocks = async () => arr<any>(await get('/mocks?limit=500'))
export const addMock = (m: object) => write('POST', '/mocks', m)
export const getJobs = async () => arr<any>(await get('/jobs?limit=500'))
export const addJob = (j: object) => write('POST', '/jobs', j)
export const patchJob = (id: string, p: object) => write('PATCH', `/jobs/${id}`, p)
export const getJobToday = () => get<{ date: string; applications: number; outreach: number; minutes: number }>('/jobs/today')
export const logOutreach = () => write('POST', '/jobs/outreach', {})

// ---------- stats / export ----------
export const getStats = () => get('/stats/overview')
export const getStreaks = () => get('/streaks')
export const exportAll = () => request('GET', '/export')

// ---------- sync loop ----------
export async function prefetch() {
  const day = today()
  const refreshBank = bankPrefetchDay !== day
  if (refreshBank) bankPrefetchDay = day
  await Promise.allSettled([getToday(), getFullPlan(), getTopics(), getDueCards(), getCards(), getMistakes(), getBank(refreshBank), getSettings()])
}
let bankPrefetchDay = ''
let started = false
export async function startSync() {
  if (started) return; started = true
  await initOutbox().catch(e => setSync({ error: `Offline storage unavailable: ${String(e)}` }))
  const go = async () => { await flush(); if (!syncState().offline) prefetch() }
  addEventListener('online', () => { setSync({ offline: false }); go() })
  addEventListener('offline', () => setSync({ offline: true }))
  addEventListener('visibilitychange', () => { if (!document.hidden) flush() })
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data === 'flush-outbox') flush() })
  setInterval(() => { if (!document.hidden && navigator.onLine) go() }, 5 * 60 * 1000)
  navigator.storage?.persist?.().catch(() => {})
  go()
}

export async function doLogout() {
  try { localStorage.setItem(SIGNED_OUT, '1') } catch { /* storage unavailable */ }
  try { await logout() } catch { /* offline */ }
  location.hash = '#/today'; location.reload()
}

export const getModules = () => get<{items:{id:string;available:boolean;enabled:boolean}[]}>('/modules')
export const patchModule = (id: string, enabled: boolean) => request('PATCH', `/modules/${id}`, { enabled })
export const getOnboardingStatus = () => get<{needs_setup:boolean}>('/onboarding/status')
export async function setupPlan(body: object) { const result = await request('POST', '/onboarding', body); await kv.set('c:/onboarding/status', { needs_setup: false }); return result }


// ---------- learn: concepts, notes, bookmarks ----------
export const getConcepts = async () => { const r = await get('/concepts'); return { items: arr<Concept>(r), chapters: new Map<string, string>((r?.chapters ?? []).map((c: any) => [c.topic_id, c.summary as string])) } }
export type ConceptStatus = 'got_it' | 'learning'
export const getConceptProgress = async () => { const m = new Map<string, ConceptStatus>(); for (const x of arr<any>(await get('/concepts/progress'))) m.set(x.topic_id + '/' + x.atom_id, x.status); return m }
export const setConcept = (topic: string, atom: string, status: ConceptStatus | null) => write('PUT', `/concepts/${encodeURIComponent(topic)}/${encodeURIComponent(atom)}`, { status })
export const getNote = async (topic: string): Promise<string> => (await get(`/topics/${encodeURIComponent(topic)}/note`))?.body ?? ''
export const getNotes = async () => arr<{ topic_id: string; body: string; updated_at: string }>(await get('/notes'))
export const putNote = (topic: string, body: string) => write('PUT', `/topics/${encodeURIComponent(topic)}/note`, { body })
export const getBookmarks = async () => new Set(arr<any>(await get('/bookmarks')).map((x) => x.question_id as string))
export const setBookmark = (qid: string, on: boolean) => write(on ? 'PUT' : 'DELETE', `/bookmarks/${encodeURIComponent(qid)}`)

// ---------- tests ----------
export async function createTest(kind: TestKind, scope: Record<string, unknown> = {}, count?: number): Promise<TestSession> {
  const r = await request('POST', '/tests', { kind, scope, count })
  return { ...r, questions: (r.questions as any[]).map(normQ) }
}
export const submitTest = (id: string, answers: { question_id: string; given_answer: string | null; time_s: number; marked?: boolean }[], duration_s: number): Promise<TestResult> => request('POST', `/tests/${id}/submit`, { answers, duration_s })
export const getTest = async (id: string) => { const r = await get(`/tests/${id}`); return { ...r, questions: (r.questions as any[]).map(normQ) } as { id: string; kind: TestKind; scope: any; allowed_s: number; submitted_at: string | null; result: TestResult | null; questions: Q[] } }
export const getTests = async () => arr<any>(await get('/tests?limit=20'))
export const getPapers = async () => arr<{ year: number; paper: string; session: string; n: number }>(await get('/tests/papers'))
export const getWeak = async () => arr<{ topic_id: string; name: string; attempts: number; accuracy: number }>(await get('/tests/weak'))

// ---------- past-paper weightage (average marks per paper) ----------
export interface WeightPaper { n_papers: number; subjects: Record<string, number>; chapters: Record<string, { avg_marks: number; questions: number; years: number }> }
export const getWeightage = async (): Promise<{ CS: WeightPaper | null; DA: WeightPaper | null }> => { const r = await get('/weightage'); return { CS: r?.CS ?? null, DA: r?.DA ?? null } }

// ---------- analytics, coaching inbox, reminders ----------
export const getMastery = () => get<any>('/mastery')
export const getPriority = (paper: 'CS'|'DA') => get<any>('/priority?paper='+paper)
export const getStrategy = (id: string) => get<any>('/strategy/'+encodeURIComponent(id))
export const getPeriodAnalytics = (period: 'weekly'|'monthly') => get<any>('/analytics/period?period='+period)
export const getEnergyAnalytics = () => get<any>('/analytics/energy')
export const getScores = () => get<any>('/analytics/scores')
export const getDigest = (from: string,to: string) => get<any>(`/digest?from=${from}&to=${to}`)
export const getDoubts = () => get<any>('/doubts')
export const addDoubt = (ref_type: 'question'|'concept'|'chapter', ref_id: string, note: string) => write('POST','/doubts',{ref_type,ref_id,note})
export const patchDoubt = (id:string, p:Record<string,unknown>) => write('PATCH','/doubts/'+encodeURIComponent(id),p)
export const getReports = () => get<any>('/reports')
export const patchReport = (id:string,read:boolean) => write('PATCH','/reports/'+encodeURIComponent(id),{read})
export const getConceptVideo = (topic:string, atom:string) => get<any>(`/videos/for-concept?topic_id=${encodeURIComponent(topic)}&atom_id=${encodeURIComponent(atom)}`)
export const getQuestionVideo = (id:string) => get<any>('/videos/for-question/'+encodeURIComponent(id))
export const getDrill = (duration_s:60|120) => get<any>('/drills/questions?duration_s='+duration_s)
export const postDrill = (duration_s:60|120,answers:{id:string;answer:string}[]) => write('POST','/drills/results',{duration_s,answers})
export const getVapid = () => get<any>('/push/vapid')
export const addPushSubscription = (subscription:PushSubscriptionJSON) => write('POST','/push/subscriptions',subscription)
export const removePushSubscription = (endpoint:string) => write('DELETE','/push/subscriptions',{endpoint})
