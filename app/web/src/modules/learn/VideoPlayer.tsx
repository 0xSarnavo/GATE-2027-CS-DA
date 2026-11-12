import { useEffect, useRef, useState } from 'preact/hooks'
import { getVideoChapter, putVideoProgress } from '../../api'
import { Icon } from '../../ui'
import { useLayer } from '../../router'
import { mmss } from '../../util'
import { Md } from '../../md'
import { setVideoActive } from '../../active-time'

export interface VideoClip { id?: string; title?: string; url: string; topic_id?: string; start_s?: number; duration_s?: number; concepts?: { atom_id: string; start_s: number; note?: string | null }[] }
const event = 'gate-video-open'
export function openVideo(video: VideoClip) { dispatchEvent(new CustomEvent(event, { detail: video })) }
export function youtubeId(url: string) {
  try { const u = new URL(url); if (u.hostname === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname)) return null
    const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]
    return id && /^[\w-]{11}$/.test(id) ? id : null
  } catch { return null }
}
function urlStart(url: string) {
  try { const u = new URL(url), t = u.searchParams.get('t') || u.searchParams.get('start') || u.hash.match(/t=(.*)/)?.[1] || ''
    if (/^\d+$/.test(t)) return Number(t)
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/); return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0
  } catch { return 0 }
}
const saved = (id: string) => { try { return Math.max(0, Number(localStorage.getItem('video:' + id)) || 0) } catch { return 0 } }
const remember = (id: string, s: number) => { try { localStorage.setItem('video:' + id, String(Math.floor(s))) } catch { /* storage unavailable */ } }
let api: Promise<any> | null = null
function youtubeApi() {
  if ((window as any).YT?.Player) return Promise.resolve((window as any).YT)
  return api ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => reject(new Error('YouTube unavailable'))
    ;(window as any).onYouTubeIframeAPIReady = () => resolve((window as any).YT)
    document.head.append(script)
  }).catch(e => { api = null; throw e })
}

export function VideoPlayer() {
  const [clip, setClip] = useState<VideoClip | null>(null)
  const [small, setSmall] = useState(false), [full, setFull] = useState(false)
  const [online, setOnline] = useState(navigator.onLine), [position, setPosition] = useState(0)
  const [resume, setResume] = useState(0), [markers, setMarkers] = useState<VideoClip['concepts']>([])
  const [names, setNames] = useState<Record<string,string>>({}), [error, setError] = useState('')
  const player = useRef<any>(null), pos = useRef(0), lastSent = useRef(-1), ready = useRef(false), pendingSeek = useRef<number | null>(null)
  const id = clip && youtubeId(clip.url)
  const key = clip?.id || id || ''
  useEffect(() => { setVideoActive(null, !!clip) }, [key])
  const save = (force = false, done = false) => {
    if (!clip || !key) return
    const s = Math.floor(pos.current); remember(key, s)
    if (clip.id && (force || Math.abs(s - lastSent.current) >= 15)) { lastSent.current = s; putVideoProgress(clip.id, s, done || undefined).catch(() => {}) }
  }
  useEffect(() => {
    const open = (e: Event) => { const v = (e as CustomEvent<VideoClip>).detail; const start_s = v.start_s || urlStart(v.url); ready.current = false; pendingSeek.current = null; setVideoActive(null, true); setClip({ ...v, start_s }); setSmall(false); setError(''); setResume(saved(v.id || youtubeId(v.url) || '')); setPosition(start_s); pos.current = start_s }
    const change = () => setOnline(navigator.onLine)
    addEventListener(event, open); addEventListener('online', change); addEventListener('offline', change)
    return () => { removeEventListener(event, open); removeEventListener('online', change); removeEventListener('offline', change) }
  }, [])
  useEffect(() => {
    if (!clip?.topic_id || !clip.id) { setMarkers(clip?.concepts || []); setNames({}); return }
    let live = true
    getVideoChapter(clip.topic_id).then(c => { if (!live) return; const v = [...c.full_lectures,...c.more_videos].find((x: VideoClip) => x.id === clip.id); setMarkers(v?.concepts || clip.concepts || []); setNames(Object.fromEntries(c.concepts.map((x: any) => [x.atom_id,x.name]))) }).catch(() => { if (live) setMarkers(clip.concepts || []) })
    return () => { live = false }
  }, [clip?.id, clip?.topic_id])
  useEffect(() => {
    if (!clip || !id || !online) return
    let active = true, timer: ReturnType<typeof setInterval> | undefined
    youtubeApi().then(YT => {
      if (!active) return
      const iframe = document.getElementById('gate-video-frame') as HTMLIFrameElement | null
      if (!iframe) return
      player.current = new YT.Player(iframe, { events: {
        onReady: () => { if (!active) return; ready.current = true; const start = pendingSeek.current ?? clip.start_s; if (start) player.current?.seekTo(start, true); if (pendingSeek.current !== null) player.current?.playVideo?.(); pendingSeek.current = null; timer = setInterval(() => { const s = player.current?.getCurrentTime?.(); if (Number.isFinite(s)) { pos.current = s; setPosition(s); save() } }, 1000) },
        onStateChange: (e: any) => { setVideoActive(e.data === YT.PlayerState.PLAYING ? clip.topic_id || null : null, true); if (e.data === YT.PlayerState.ENDED) save(true, true); else if (e.data === YT.PlayerState.PAUSED) save(true) },
        onError: () => setError('Video unavailable. Open it in YouTube.')
      } })
    }).catch(() => active && setError('Video unavailable. Open it in YouTube.'))
    return () => { active = false; ready.current = false; setVideoActive(null, false); clearInterval(timer); save(true); player.current?.destroy?.(); player.current = null }
  }, [id, clip?.start_s, online])
  useLayer(!!clip && !small, () => { save(true); setClip(null); setFull(false) }) // system back closes the player
  if (!clip) return null
  const seek = (s: number) => { pos.current = s; setPosition(s); if (!ready.current) { pendingSeek.current = s; return } player.current?.seekTo?.(s, true); player.current?.playVideo?.() }
  const close = () => { save(true); setVideoActive(null, false); setClip(null); setFull(false) }
  const active = [...(markers || [])].sort((a,b) => a.start_s - b.start_s).filter(m => m.start_s <= position).at(-1)?.atom_id
  return <aside class={'video-sheet' + (small ? ' mini' : '') + (full ? ' fullscreen' : '')} role="region" aria-label="Video player">
    <div class="video-head"><b><Md text={clip.title || 'Video'}/></b><div class="row gap"><button class="icon-btn" aria-label={small ? 'Expand player' : 'Minimize player'} onClick={() => setSmall(!small)}>{small ? '▣' : '▁'}</button><button class="icon-btn" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => { setFull(!full); setSmall(false) }}>⛶</button><button class="icon-btn" aria-label="Close player" onClick={close}><Icon.close size={20} /></button></div></div>
    <div class="video-frame">{!online ? <p>Videos need internet</p> : !id ? <p>This video cannot play in the app.</p> : error ? <p>{error}</p> : <iframe id="gate-video-frame" title={clip.title || 'YouTube video'} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen src={`https://www.youtube-nocookie.com/embed/${id}?start=${Math.max(0,Math.floor(clip.start_s || 0))}&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`} />}</div>
    {!small && <div class="video-body">{resume > 5 && Math.abs(resume - (clip.start_s || 0)) > 5 && <button class="btn sm" onClick={() => seek(resume)}>Resume at {mmss(resume)}</button>}
        <div class="row between"><small>{mmss(position)}</small>{(id || /^https?:\/\//i.test(clip.url)) && <a href={id ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(position)}s` : clip.url} target="_blank" rel="noopener noreferrer">{id ? 'Open in YouTube' : 'Open original video'}</a>}</div>
        {!!markers?.length && <div class="video-chapters"><h3>Concepts</h3>{[...markers].sort((a,b) => a.start_s - b.start_s).map(m => <button class={'video-chapter' + (m.atom_id === active ? ' on' : '')} aria-current={m.atom_id === active ? 'true' : undefined} onClick={() => seek(m.start_s)}><span>{mmss(m.start_s)}</span><b><Md text={names[m.atom_id] || m.atom_id}/></b>{m.note && <small><Md text={m.note}/></small>}</button>)}</div>}
      </div>}
  </aside>
}
