import { today } from '../../util'

export const planDate = (part?: string) => {
  if (!part || !/^\d{4}-\d{2}-\d{2}$/.test(part)) return today()
  const d = new Date(part + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === part ? part : today()
}
