import { lazy } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { getModules } from '../api'

export const screens = {
  search: { module: 'core', component: lazy(() => import('./core/Search')) },
  today: { module: 'planner', component: lazy(() => import('./planner/Today')) },
  learn: { module: 'learn', component: lazy(() => import('./learn/Learn')) },
  test: { module: 'practice', component: lazy(() => import('./test/Test')) },
  plan: { module: 'planner', component: lazy(() => import('./planner/Plan')) },
  calendar: { module: 'planner', component: lazy(() => import('./planner/Calendar')) },
  priority: { module: 'practice', component: lazy(() => import('./practice/Priority')) },
  drill: { module: 'practice', component: lazy(() => import('./practice/Drill')) },
  practice: { module: 'practice', component: lazy(() => import('./practice/Practice').then(m => ({ default: m.Practice }))) },
  topic: { module: 'practice', component: lazy(() => import('./practice/Practice').then(m => ({ default: m.TopicPage }))) },
  q: { module: 'practice', component: lazy(() => import('./practice/Question')) },
  mistakes: { module: 'practice', component: lazy(() => import('./practice/Mistakes')) },
  cards: { module: 'review', component: lazy(() => import('./review/Cards')) },
  log: { module: 'habits', component: lazy(() => import('./habits/Log')) },
  stats: { module: 'habits', component: lazy(() => import('./habits/Stats')) },
  insights: { module: 'insights', component: lazy(() => import('./insights/Insights')) },
  settings: { module: 'core', component: lazy(() => import('./core/Settings')) },
  dev: { module: 'learn', component: lazy(() => import('./learn/Gallery').then(m => ({ default: m.AnimGallery }))) },
} as const
export const tabs = [
  { id: 'today', label: 'Today', module: 'planner' }, { id: 'learn', label: 'Learn', module: 'learn' },
  { id: 'practice', label: 'Practice', module: 'practice' }, { id: 'test', label: 'Test', module: 'practice' },
  { id: 'cards', label: 'Review', module: 'review' },
] as const
/** Reached from the profile menu on phones; shown in the side rail on wide screens. */
export const extras = [
  { id: 'plan', label: 'Plan', module: 'planner' }, { id: 'log', label: 'Log', module: 'habits' },
  { id: 'stats', label: 'Stats', module: 'habits' }, { id: 'insights', label: 'Doubts', module: 'insights' }, { id: 'settings', label: 'Settings', module: 'core' },
] as const
export interface ModuleInfo { id: string; available: boolean; enabled: boolean }
let modules: ModuleInfo[] = []
const listeners = new Set<() => void>()
export function setModules(items: ModuleInfo[]) { modules = items; listeners.forEach(fn => fn()) }
export function useModules() {
  const [, refresh] = useState(0)
  useEffect(() => { const fn = () => refresh(n => n + 1); listeners.add(fn); return () => { listeners.delete(fn) } }, [])
  return modules
}
export const moduleEnabled = (id: string) => id === 'core' || modules.some(m => m.id === id && m.enabled)
export async function refreshModules() { setModules((await getModules()).items) }
