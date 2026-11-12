import { useState } from 'preact/hooks'
import { useModules } from '../index'
import { addDoubt, isQueued } from '../../api'
import { Field, Sheet, toast } from '../../ui'
export function DoubtButton({refType,refId}: {refType:'question'|'concept'|'chapter';refId:string}) {
  const modules=useModules()
  const [open,setOpen]=useState(false), [note,setNote]=useState(''), [busy,setBusy]=useState(false)
  const save=async () => { setBusy(true); try { const r=await addDoubt(refType,refId,note.trim()); toast(isQueued(r)?'Doubt saved offline':'Doubt added'); setOpen(false);setNote('') } catch(e:any) { toast(e.message) } setBusy(false) }
  if (!modules.some(m=>m.id==='insights'&&m.enabled)) return null
  return <><button class="btn sm" onClick={() => setOpen(true)}>Doubt</button>{open && <Sheet title="Add a doubt" onClose={() => setOpen(false)}><Field label="What is unclear?"><textarea rows={5} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} /></Field><button class="btn primary block" disabled={!note.trim()||busy} onClick={save}>Save doubt</button></Sheet>}</>
}
