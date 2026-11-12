import { useState } from 'preact/hooks'
import { getMistakes, getQuestion, reviewMistake } from '../../api'
import { Header, Loading, useLoad, Empty, toast } from '../../ui'
import { go, back } from '../../router'
import { QuestionView } from './Question'
import { setQueue } from '../../queue'
import type { Mistake, Q } from '../../types'

export default function Mistakes() {
  const { data, error, loading, reload } = useLoad(async () => {
    const ms = await getMistakes(true)
    const withQ: Mistake[] = []
    for (const m of ms) { try { withQ.push({ ...m, question: m.question ?? (await getQuestion(m.question_id)) }) } catch { /* skip unreadable */ } }
    setQueue(withQ.map((m) => m.question!.id)); return withQ
  }, [])
  const [i, setI] = useState(0)
  const exit = () => back(() => go('today'))
  if (loading || !data) return <><Header title="Mistakes" onBack={exit} menu={false} /><main class="page"><Loading error={error} retry={reload} /></main></>
  if (!data.length || i >= data.length)
    return <><Header title="Mistakes" onBack={exit} menu={false} /><main class="page"><Empty title={data.length ? 'Revision done' : 'Nothing to revise today'}>{data.length ? 'Those mistakes are scheduled to come back later.' : 'Questions you get wrong come back here after 1 day, 1 week and 3 weeks.'}<br /><button class="btn primary" onClick={exit}>Back to Today</button></Empty></main></>
  const m = data[i]; const q = m.question as Q
  return (
    <QuestionView key={m.id} q={q} onExit={exit} nextLabel={i + 1 < data.length ? 'Next mistake' : 'Finish'}
      onNext={() => setI(i + 1)}
      onResult={(ok) => reviewMistake(m.id, ok).catch(() => toast('Could not save review'))} />
  )
}
