import { useState } from 'preact/hooks'
import { getVideoChapter, getVideoCourse, getVideoProgress, getVideosForConcept, putVideoProgress } from '../../api'
import { Header, Loading, useLoad, toast } from '../../ui'
import { go } from '../../router'
import { mmss } from '../../util'
import { Md } from '../../md'
import { openVideo, type VideoClip } from './VideoPlayer'

function chips(v: VideoClip & Record<string,any>) {
  const lang = (v.lang || v.language || 'en').toLowerCase()
  return <div class="video-chip-row"><span class="tag">{lang === 'en' ? 'EN' : 'Hinglish'}</span>{v.published && <span class="tag">{v.published.slice(0,4)}</span>}{v.duration_s && <span class="tag">{mmss(v.duration_s)}</span>}{!v.concepts?.some(c => c.start_s > 0) && <small class="muted">timestamps pending</small>}</div>
}
function VideoItem({ v, start = 0, title }: { v: VideoClip & Record<string,any>; start?: number; title?: string }) {
  return <div class="video-item"><b><Md text={title || v.title || 'Video'} /></b>{chips(v)}<button class="btn sm" onClick={() => openVideo({ ...v, start_s: start })}>Watch{start > 0 ? ' from ' + mmss(start) : ''}</button></div>
}

export function VideoCatalog({ topic }: { topic: string }) {
  const { data, loading } = useLoad(() => getVideoChapter(topic), [topic])
  if (loading) return <section class="card"><h2>Videos</h2><Loading /></section>
  const concepts = data?.concepts || []
  const full = data?.full_lectures || [], more = data?.more_videos || []
  return <section class="card" aria-label="Videos"><h2>Videos</h2>
    {!concepts.length && !full.length && !more.length && <p class="muted">No curated videos for this chapter yet.</p>}
    {!!concepts.length && <><h3>By concept</h3><div class="video-list">{concepts.map((c: any) => c.video ? <VideoItem v={c.video} title={c.name + ' · ' + (c.video.title || 'Video')} start={c.video.start_s || 0} /> : <div class="video-item"><Md text={c.name}/><small class="muted">No clip yet</small></div>)}</div></>}
    {!!full.length && <><h3>Full lectures</h3><div class="video-list">{full.map((v: any) => <div><VideoItem v={v} /><details><summary>Concept jump points</summary>{v.concepts.length ? v.concepts.map((c: any) => <button class="video-chapter" onClick={() => openVideo({ ...v, start_s: c.start_s })}><span>{mmss(c.start_s)}</span><Md text={data.concepts.find((x:any)=>x.atom_id===c.atom_id)?.name || c.atom_id} /></button>) : <p class="muted">Timestamps pending.</p>}</details></div>)}</div></>}
    {!!more.length && <><h3>More videos</h3><div class="video-list">{more.map((v: any) => <VideoItem v={v} />)}</div></>}
  </section>
}

export function ConceptVideos({ topic, atom }: { topic: string; atom: string }) {
  const { data } = useLoad(() => getVideosForConcept(topic, atom), [topic, atom])
  if (!data?.items?.length) return null
  return <section class="card"><h2>Videos for this concept</h2><div class="video-list">{data.items.map((v: any) => <VideoItem v={v} start={v.start_s || 0} />)}</div></section>
}

export function VideoCourse({ subject }: { subject: string }) {
  const course = useLoad(() => getVideoCourse(subject), [subject])
  const progress = useLoad(getVideoProgress, [])
  const [busy, setBusy] = useState('')
  const tick = async (v: VideoClip, done: boolean) => { if (!v.id) return; setBusy(v.id); try { await putVideoProgress(v.id, 0, done); await progress.reload() } catch { toast('Could not save video progress') } finally { setBusy('') } }
  return <><Header title="Video course" onBack={() => go('learn/' + subject)} /><main class="page"><h2>Video course</h2>
    {course.loading ? <Loading error={course.error} retry={course.reload} /> : !course.data?.chapters?.length ? <p>No chapters yet.</p> : <ol class="video-list">{course.data.chapters.map((c: any) => {
      const lead = c.full_lectures[0] as VideoClip | undefined
      const clips = lead ? [lead] : c.concepts.filter((x:any)=>x.video).map((x:any)=>x.video) as VideoClip[]
      return <li class="card"><h3><Md text={c.name}/></h3>{!clips.length ? <p class="muted">No curated videos yet.</p> : clips.map(v => {
        const done = !!progress.data?.items?.find((p:any)=>p.video_id===v.id)?.completed
        return <div class="row gap wrap"><button class="btn sm grow" onClick={() => openVideo(v)}><Md text={v.title || 'Watch'}/></button><button class="btn sm" disabled={busy===v.id} aria-pressed={done} onClick={() => tick(v,!done)}>{done ? '✓ Watched' : '○ Unwatched'}</button></div>
      })}<button class="btn sm" onClick={() => go('learn/' + c.id)}>Open chapter</button></li>
    })}</ol>}
  </main></>
}
