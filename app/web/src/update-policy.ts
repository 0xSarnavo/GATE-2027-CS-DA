/** Only an active question or test gets the update card. */
export function isMidTask(hash: string): boolean {
  return /^#?\/?q\/(?!done(?:\?|$))|^#?\/?test\/run(?:\/|\?|$)/.test(hash)
}

export function updateAction(ready: boolean, mid: boolean, laterFor: string | null, build: string | null): 'none' | 'apply' | 'card' {
  if (!ready) return 'none'
  if (!mid) return 'apply'
  return !build || laterFor === build ? 'none' : 'card'
}
