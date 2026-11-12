/**
 * Content importer: tags, ladders, external cross-checks, discussion links, WebP image refs.
 * Idempotent and re-runnable (re-run whenever new files land in app/data/*). Missing/partial files are fine.
 *
 *   bun run import-content                -> into DATA_DIR/gate.db (same DB the server uses)
 *   POST /api/import/content              -> same, against the running server (files read from the deploy bundle)
 *   server boot                           -> runs automatically unless IMPORT_ON_BOOT=0
 *
 * Order matters (later steps may refine earlier ones): tags -> external -> ladders -> links -> images -> review flags.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "../server/db";
import { config } from "../server/config";
import { now } from "../server/util";
import { validateScene } from "../web/src/anim/validate";
import { seedMissingTopics } from "./load";

const appRoot = resolve(import.meta.dir, "..");
const dataDir = config.contentDir;
const KEYS = new Set("ABCDEFGH".split(""));

export interface ImportReport { counts: Record<string, number>; warnings: string[]; files: Record<string, number> }

function readJson(path: string, warnings: string[]): any | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { warnings.push(`${path}: invalid JSON (${(e as Error).message}); skipped`); return null; }
}
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort() : []);
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

/** DB answer format from the several shapes agents/scrapers write. Alternatives accepted by the key are joined by '|'. */
function normAnswer(a: any): string {
  if (Array.isArray(a)) return [...new Set(a.map(x => String(x).trim()))].sort().join(",");
  if (a && typeof a === "object" && Array.isArray(a.any_of)) return a.any_of.map(normAnswer).join("|");
  if (a && typeof a === "object" && Array.isArray(a.ranges)) return a.ranges.map((r: number[]) => (r[0] === r[1] ? String(r[0]) : `${r[0]}..${r[1]}`)).join("|");
  return String(a ?? "").trim();
}
function normOptions(o: any): { key: string; text: string }[] | null {
  if (!Array.isArray(o) || !o.length) return null;
  return o.map((x, i) => (typeof x === "string" ? { key: "ABCDEFGH"[i]!, text: x } : { key: String(x.key ?? "ABCDEFGH"[i]).toUpperCase(), text: String(x.text ?? "") }));
}

export function runImportContent(videosDir = join(dataDir, 'videos')): ImportReport {
  const t = now();
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  const files: Record<string, number> = { tags: 0, ladders: 0, external: 0, pre2017: 0 };
  const add = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const warn = (m: string) => { if (warnings.length < 200) warnings.push(m); };
  add("topics", seedMissingTopics());

  const topicIds = new Set((db.query("SELECT id FROM topics WHERE deleted_at IS NULL").all() as any[]).map(r => r.id));
  if (!topicIds.size) { warn("no topics in the database; run `bun run seed` first"); return { counts, warnings, files }; }
    const qExists = db.query("SELECT id, source, answer, answer_source, created_by FROM questions WHERE id=? AND deleted_at IS NULL");

  db.transaction(() => {
    // ------------------------------------------------------------ prerequisites (additive, safe to re-run)
    const prereqs = readJson(join(dataDir, "prereqs.json"), warnings);
    if (prereqs && typeof prereqs === "object" && !Array.isArray(prereqs)) {
      const insert = db.query("INSERT OR IGNORE INTO topic_prereqs(topic_id,prereq_id,kind,sort) VALUES (?,?,?,?)");
      for (const [chapter, groups] of Object.entries(prereqs) as [string, any][]) {
        if (!topicIds.has(chapter)) { warn(`prereqs: unknown chapter ${chapter}`); continue; }
        for (const [kind, ids] of [["foundation", groups?.foundations], ["chapter", groups?.chapters]] as const) {
          if (!Array.isArray(ids)) { warn(`prereqs: ${chapter} missing ${kind} list`); continue; }
          ids.forEach((id: string, sort: number) => {
            if (!topicIds.has(id) || id === chapter) { warn(`prereqs: ${chapter} has unknown/self prerequisite ${id}`); return; }
            add("prereqs", insert.run(chapter, id, kind, sort).changes);
          });
        }
      }
    }
    // ------------------------------------------------------------ 0. pre-2017 questions (GATE Overflow scrape; remote images)
    const tagMap: Record<string, string> = readJson(join(appRoot, "seed", "go_tag_map.json"), warnings)?.tags ?? {};
    const depth = (id: string) => { let n = 0, cur: string | undefined = id; const p = db.query("SELECT parent_id FROM topics WHERE id=?"); while (cur && n < 9) { cur = (p.get(cur) as any)?.parent_id ?? undefined; if (cur) n++; } return n; };
    const dcache = new Map<string, number>();
    const dep = (id: string) => dcache.get(id) ?? (dcache.set(id, depth(id)), dcache.get(id)!);
    const upPre = db.query(`INSERT INTO questions(id,source,paper,year,session,q_no,topic_id,type,marks,stem,options,answer,difficulty,image_refs,needs_review,answer_source,discussion_url,created_by,created_at,updated_at)
      VALUES (?, 'official', ?,?,?,?,?,?,?,?,?,?,?,?,?, 'gateoverflow', ?, 'import', ?, ?)
      ON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id, type=excluded.type, marks=excluded.marks, stem=excluded.stem, options=excluded.options, answer=excluded.answer,
        difficulty=excluded.difficulty, image_refs=excluded.image_refs, needs_review=excluded.needs_review, discussion_url=excluded.discussion_url, deleted_at=NULL
      WHERE questions.answer_source='gateoverflow'`);
    const setTopics = db.query("INSERT OR IGNORE INTO question_topics(question_id, topic_id) VALUES (?,?)");
    const clrTopics = db.query("DELETE FROM question_topics WHERE question_id=?");
    for (const f of jsonFiles(join(dataDir, "external", "pre2017"))) {
      const rows = readJson(join(dataDir, "external", "pre2017", f), warnings);
      if (!Array.isArray(rows)) continue;
      files.pre2017 = (files.pre2017 ?? 0) + 1;
      for (const r of rows) {
        const id = String(r.id ?? "");
        const existing = qExists.get(id) as any;
        if (existing && existing.answer_source !== "gateoverflow") continue;
        const type = r.q_type === "NAT" ? "NAT" : r.q_type === "MSQ" ? "MSQ" : "MCQ";
        if (!id || !r.text) { warn(`pre2017/${f}: ${id || "(no id)"} skipped (no id/text)`); continue; }
        const mapped = [...new Set<string>((r.tags ?? []).map((x: string) => tagMap[x]).filter((x: string | undefined): x is string => !!x && topicIds.has(x)))]
          .sort((a, b) => dep(b) - dep(a));
        const topic = mapped[0] ?? "general.unsorted";
        const tg: string[] = r.tags ?? [];
        const diff = tg.includes("easy") ? 2 : tg.includes("difficult") || tg.includes("hard") ? 4 : 3;
        const options = normOptions(r.options);
        const answer = r.answer === "MTA" ? "MTA" : normAnswer(r.answer);
        const qno = id.slice(id.indexOf("-q") + 2);
        upPre.run(id, r.paper ?? "CS", r.exam_year, String(r.session ?? "CS"), qno, topic, type, Number(r.marks) >= 2 ? 2 : 1, String(r.text), j(options), answer, diff,
          JSON.stringify((r.images ?? []).filter((x: string) => /^https?:/.test(x))), r.needs_review || !answer ? 1 : 0, str(r.source_url), t, t);
        clrTopics.run(id);
        for (const s of mapped.slice(1)) setTopics.run(id, s);
        add(topic === "general.unsorted" ? "pre2017_unsorted" : "pre2017");
      }
    }

    // ------------------------------------------------------------ 1. tags
    const updTag = db.query("UPDATE questions SET topic_id=?, difficulty=?, in_2027_syllabus=?, syllabus_note=?, updated_at=? WHERE id=? AND deleted_at IS NULL");
    const delSec = db.query("DELETE FROM question_topics WHERE question_id=?");
    const insSec = db.query("INSERT OR IGNORE INTO question_topics(question_id, topic_id) VALUES (?,?)");
    for (const f of jsonFiles(join(dataDir, "tags"))) {
      const rows = readJson(join(dataDir, "tags", f), warnings);
      if (!Array.isArray(rows)) continue;
      files.tags++;
      for (const r of rows) {
        const ids: string[] = (r.topic_ids ?? []).filter((x: string) => topicIds.has(x));
        if (!ids.length) { warn(`tags/${f}: ${r.id} has no known topic_ids`); continue; }
        const diff = Math.min(5, Math.max(1, Number(r.difficulty) || 3));
        const res = updTag.run(ids[0]!, diff, r.in_2027_syllabus === false ? 0 : 1, str(r.note), t, r.id);
        if (!res.changes) { warn(`tags/${f}: unknown question ${r.id}`); continue; }
        delSec.run(r.id);
        for (const s of ids.slice(1)) insSec.run(r.id, s);
        add("tagged");
      }
    }

    // ------------------------------------------------------------ 2. external answer cross-check
    // filled + official key  -> answer_source 'official-key', needs_review=0
    // filled + GO-only       -> answer_source 'external', needs_review=1 until an independent re-solve agrees (step 6)
    // any_of alternatives    -> stored 'A,C,D|C,D'; replaces a corrupted flattened key; ranges force type NAT
    const fillOff = db.query("UPDATE questions SET answer=?, answer_source='official-key', needs_review=0, updated_at=? WHERE id=? AND (answer='' OR answer_source='official-key')");
    const fillExt = db.query("UPDATE questions SET answer=?, answer_source='external', needs_review=1, updated_at=? WHERE id=? AND (answer='' OR answer_source='external')");
    const setAlts = db.query("UPDATE questions SET answer=?, updated_at=? WHERE id=? AND answer<>?");
    const setNat = db.query("UPDATE questions SET type='NAT', updated_at=? WHERE id=? AND type<>'NAT'");
    const setDisc = db.query("UPDATE questions SET discussion_url=? WHERE id=? AND discussion_url IS NULL");
    const setDisagree = db.query("UPDATE questions SET answer_check='disagrees', answer_check_note=?, updated_at=? WHERE id=? AND answer_check IS NULL");
    const cc = readJson(join(dataDir, "external", "answer_crosscheck.json"), warnings);
    if (Array.isArray(cc)) {
      files.external++;
      for (const r of cc) {
        const q = qExists.get(r.id) as any;
        if (!q) { warn(`answer_crosscheck: unknown question ${r.id}`); continue; }
        const status = String(r.status ?? "").toLowerCase();
        const ans = normAnswer(r.external_answer);
        const official = /^official/.test(String(r.source ?? ""));
        if (r.discussion_url && setDisc.run(String(r.discussion_url), r.id).changes) add("links");
        if (r.external_answer && typeof r.external_answer === "object" && Array.isArray(r.external_answer.ranges)) { if (setNat.run(t, r.id).changes) add("type_fixed"); }
        if (status === "filled") {
          if (!ans) { warn(`answer_crosscheck: ${r.id} filled but empty external_answer`); continue; }
          if ((official ? fillOff : fillExt).run(ans, t, r.id).changes) add("answers_filled"); else add("answers_kept"); // an existing answer is never overwritten
        } else if (status === "agrees" && ans.includes("|") && official) {
          if (setAlts.run(ans, t, r.id, ans).changes) add("answers_alternatives");
        } else if (/disagree|conflict|mismatch/.test(status) && q.answer) {
          if (setDisagree.run(`External source (${r.source_url ?? "?"}) says ${ans}; our key says ${q.answer}.`, t, r.id).changes) add("external_disagrees");
        }
      }
    }

    // ------------------------------------------------------------ 3. ladders
    const updPyq = db.query(`UPDATE questions SET
        difficulty=COALESCE(?, difficulty), quick_method=COALESCE(?, quick_method), solution=COALESCE(?, solution),
        explanation=COALESCE(?, explanation), trap_note=COALESCE(?, trap_note), hints=COALESCE(?, hints),
        solution_full=COALESCE(?, solution_full), quick_method_full=COALESCE(?, quick_method_full), explanation_full=COALESCE(?, explanation_full), trap_note_full=COALESCE(?, trap_note_full),
        answer_check=COALESCE(?, answer_check), answer_check_note=COALESCE(?, answer_check_note), updated_at=? WHERE id=? AND deleted_at IS NULL`);
    const upGen = db.query(`INSERT INTO questions(id,source,paper,year,session,q_no,topic_id,type,marks,stem,options,answer,difficulty,order_in_topic,level,atoms,hints,
        solution,quick_method,trap_note,explanation,solution_full,quick_method_full,trap_note_full,explanation_full,verified,needs_review,in_2027_syllabus,created_by,created_at,updated_at)
      VALUES (?, 'generated', NULL,NULL,NULL,NULL, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 1, 'claude', ?, ?)
      ON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id, type=excluded.type, marks=excluded.marks, stem=excluded.stem, options=excluded.options,
        answer=excluded.answer, difficulty=excluded.difficulty, order_in_topic=excluded.order_in_topic, level=excluded.level, atoms=excluded.atoms, hints=excluded.hints,
        solution=excluded.solution, quick_method=excluded.quick_method, trap_note=excluded.trap_note, explanation=excluded.explanation,
        solution_full=excluded.solution_full, quick_method_full=excluded.quick_method_full, trap_note_full=excluded.trap_note_full, explanation_full=excluded.explanation_full,
        verified=excluded.verified, needs_review=excluded.needs_review, deleted_at=NULL, updated_at=excluded.updated_at
      WHERE questions.source='generated' AND questions.created_by='claude'`);
    const upNote = db.query(`INSERT INTO topic_notes(topic_id,summary_md,summary_full_md,atoms,patterns,traps,hardest_pyq,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(topic_id) DO UPDATE SET summary_md=excluded.summary_md, summary_full_md=excluded.summary_full_md, atoms=excluded.atoms, patterns=excluded.patterns, traps=excluded.traps, hardest_pyq=excluded.hardest_pyq, updated_at=excluded.updated_at`);
    const findCard = db.query("SELECT id, created_by FROM cards WHERE topic_id=? AND front=? AND deleted_at IS NULL");
    const insCard = db.query(`INSERT INTO cards(id,topic_id,kind,front,back,hint,tags,game_ok,due_on,created_by,created_at,updated_at) VALUES (?,?, 'qa', ?,?,NULL,?,?,?, 'claude', ?, ?)`);
    const updCard = db.query("UPDATE cards SET back=?, tags=?, game_ok=?, updated_at=? WHERE id=?");
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

    for (const f of jsonFiles(join(dataDir, "ladders"))) {
      const d = readJson(join(dataDir, "ladders", f), warnings);
      if (!d || typeof d !== "object") continue;
      const topic = String(d.topic_id ?? f.replace(/\.json$/, ""));
      if (!topicIds.has(topic)) { warn(`ladders/${f}: unknown topic_id ${topic}; skipped`); continue; }
      files.ladders++;

      const bp = d.blueprint;
      if (bp && typeof bp === "object") {
        upNote.run(topic, str(bp.summary_md), str(bp.summary_full_md), j(bp.atoms), j(bp.patterns), j(bp.traps), str(bp.hardest_pyq), t); add("blueprints");
      }
      for (const e of Array.isArray(d.pyq_enrichment) ? d.pyq_enrichment : []) {
        const q = qExists.get(e.id) as any;
        if (!q) { warn(`ladders/${f}: pyq_enrichment for unknown question ${e.id}`); continue; }
        const ac = ["agrees", "disagrees", "unsure"].includes(e.answer_check) ? e.answer_check : null;
        const diff = e.difficulty ? Math.min(5, Math.max(1, Number(e.difficulty))) : null;
        updPyq.run(diff, str(e.quick_method), str(e.solution), str(e.explanation), str(e.trap_note), Array.isArray(e.hints) && e.hints.length ? j(e.hints) : null,
          str(e.solution_full), str(e.quick_method_full), str(e.explanation_full), str(e.trap_note_full), ac, str(e.answer_check_note), t, e.id);
        add("pyq_enriched");
      }
      const seen = new Set<string>();
      for (const g of Array.isArray(d.ladder) ? d.ladder : []) {
        const id = String(g.id ?? "");
        const bad = (m: string) => warn(`ladders/${f}: ${id || "(no id)"} skipped: ${m}`);
        if (!id) { bad("missing id"); continue; }
        if (seen.has(id)) { bad("duplicate id"); continue; }
        seen.add(id);
        const prev = qExists.get(id) as any;
        if (prev && (prev.source !== "generated" || prev.created_by !== "claude")) { bad("id belongs to a question outside the content pack"); continue; }
        const type = String(g.type ?? "").toUpperCase();
        const answer = normAnswer(g.answer);
        const options = normOptions(g.options);
        if (!["MCQ", "MSQ", "NAT"].includes(type)) { bad(`bad type ${g.type}`); continue; }
        if (!g.stem) { bad("missing stem"); continue; }
        if (!answer) { bad("missing answer"); continue; }
        if (type !== "NAT") {
          if (!options) { bad("MCQ/MSQ without options"); continue; }
          const have = new Set(options.map(o => o.key));
          const miss = answer.split(",").filter(k => !have.has(k.trim().toUpperCase()) || !KEYS.has(k.trim().toUpperCase()));
          if (miss.length) { bad(`answer key ${miss.join(",")} not in options`); continue; }
          if (type === "MCQ" && answer.includes(",")) { bad("MCQ with several answer keys"); continue; }
        }
        const level = Math.min(5, Math.max(1, Number(g.level) || 3));
        const hints = Array.isArray(g.hints) ? g.hints.map(String).filter(Boolean) : [];
        upGen.run(id, topic, type, Number(g.marks) >= 2 ? 2 : 1, String(g.stem), j(options), answer, level, Number(g.order_in_topic) || null, level,
          j(Array.isArray(g.atoms) ? g.atoms : []), j(hints), str(g.solution), str(g.quick_method), str(g.trap_note), str(g.explanation),
          str(g.solution_full), str(g.quick_method_full), str(g.trap_note_full), str(g.explanation_full),
          g.verified === false ? 0 : 1, g.verified === false ? 1 : 0, t, t);
        add(prev ? "generated_updated" : "generated_created");
      }
      for (const c of Array.isArray(d.flashcards) ? d.flashcards : []) {
        const front = str(c.front), back = str(c.back);
        if (!front || !back) { warn(`ladders/${f}: flashcard without front/back skipped`); continue; }
        const tags = JSON.stringify(c.kind ? [String(c.kind)] : []);
        const gameOk = front.length + back.length <= 90 ? 1 : 0;
        const ex = findCard.get(topic, front) as any;
        if (ex?.created_by === "claude") { updCard.run(back, tags, gameOk, t, ex.id); add("cards_updated"); }
        else if (ex) warn(`ladders/${f}: flashcard ${front} matches a user card; kept`);
        else { insCard.run(Bun.randomUUIDv7(), topic, front, back, tags, gameOk, today, t, t); add("cards_created"); }
      }
    }

    // ------------------------------------------------------------ 3b. explainers (cards + animation scenes); invalid scenes are dropped with a warning
    const upExp = db.query(`INSERT INTO topic_explainers(topic_id,title,data,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(topic_id) DO UPDATE SET title=excluded.title, data=excluded.data, updated_at=excluded.updated_at`);
    for (const f of jsonFiles(join(dataDir, "explainers"))) {
      const d = readJson(join(dataDir, "explainers", f), warnings);
      if (!d || !Array.isArray(d.cards)) { if (d) warn(`explainers/${f}: no cards[]; skipped`); continue; }
      const topic = String(d.topic_id ?? f.replace(/\.json$/, ""));
      if (!topicIds.has(topic)) { warn(`explainers/${f}: unknown topic_id ${topic}; skipped`); continue; }
      const scenes = (Array.isArray(d.scenes) ? d.scenes : []).filter((sc: any) => {
        const v = validateScene(sc);
        if (!v.ok) warn(`explainers/${f}: scene ${sc?.id ?? "?"} invalid, dropped: ${v.errors.slice(0, 2).join("; ")}`);
        return v.ok;
      });
      upExp.run(topic, str(d.title), JSON.stringify({ topic_id: topic, title: d.title ?? null, ...(d.chapter_note ? { chapter_note: d.chapter_note } : {}), cards: d.cards, scenes }), t);
      files.explainers = (files.explainers ?? 0) + 1; add("explainers");
    }

    // ------------------------------------------------------------ 4. discussion links
    const links = readJson(join(dataDir, "external", "question_links.json"), warnings);
    if (Array.isArray(links)) {
      files.external++;
      const upd = db.query("UPDATE questions SET discussion_url=?, updated_at=? WHERE id=? AND deleted_at IS NULL");
      for (const l of links) {
        if (!l?.id || !l?.url) continue;
        if (upd.run(String(l.url), t, l.id).changes) add("links"); else warn(`question_links: unknown question ${l.id}`);
      }
    }

    // ------------------------------------------------------------ 5. images: .png -> .webp where a WebP twin exists
    const imgDirs = [join(config.dataDir, "img"), config.devImgDir];
    const haveWebp = (name: string) => imgDirs.some(d => existsSync(join(d, name)));
    const rows = db.query("SELECT id, image_refs FROM questions WHERE image_refs LIKE '%.png%'").all() as any[];
    const updImg = db.query("UPDATE questions SET image_refs=? WHERE id=?"); // no updated_at bump: not a content change
    for (const r of rows) {
      let refs: string[]; try { refs = JSON.parse(r.image_refs); } catch { continue; }
      let changed = false;
      const out = refs.map(x => {
        if (!/^img\/[^/]+\.png$/.test(x)) return x;
        const w = x.replace(/\.png$/, ".webp");
        if (haveWebp(w.slice(4))) { changed = true; return w; }
        return x;
      });
      if (changed) { updImg.run(JSON.stringify(out), r.id); add("image_refs_webp"); }
    }

    // ------------------------------------------------------------ curated transcript-checked chapter videos
    files.videos = 0;
    const upVideo = db.query(`INSERT INTO videos(id,topic_id,subject_id,title,url,source,role,language,watched,sort,updated_at,channel,lang,published,duration_s,level,why)
      VALUES (?,?,?,?,?,?,'concept',?,0,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id,subject_id=excluded.subject_id,title=excluded.title,url=excluded.url,
        source=excluded.source,language=excluded.language,sort=excluded.sort,updated_at=excluded.updated_at,channel=excluded.channel,
        lang=excluded.lang,published=excluded.published,duration_s=excluded.duration_s,level=excluded.level,why=excluded.why`);
    const upConcept = db.query(`INSERT INTO video_concepts(video_id,topic_id,atom_id,start_s,note) VALUES (?,?,?,?,?)
      ON CONFLICT(video_id,topic_id,atom_id) DO UPDATE SET start_s=excluded.start_s,note=excluded.note`);
    for (const f of jsonFiles(videosDir)) {
      const pack = readJson(join(videosDir, f), warnings); if (!pack) continue;
      const topic = String(pack.topic_id ?? f.slice(0,-5));
      if (!topicIds.has(topic)) { warn(`videos/${f}: unknown topic ${topic}`); continue; }
      const vs = Array.isArray(pack) ? pack : pack.videos;
      if (!Array.isArray(vs)) { warn(`videos/${f}: expected videos array`); continue; }
      files.videos++;
      const subject = (db.query('SELECT subject_id FROM topics WHERE id=?').get(topic) as any)?.subject_id ?? null;
      for (let i=0;i<vs.length;i++) {
        const v=vs[i]; if (!v || typeof v!=='object') continue;
        const url=String(v.url ?? (v.youtube_id ? `https://www.youtube.com/watch?v=${v.youtube_id}` : ''));
        if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) { warn(`videos/${f}: invalid YouTube URL`); continue; }
        const id=String(v.id ?? v.youtube_id ?? `${topic}:video:${i}`);
        const lang=String(v.lang ?? v.language ?? 'en');
        upVideo.run(id,topic,subject,String(v.title ?? id),url,String(v.channel ?? v.source ?? ''),lang,i,t,
          str(v.channel),lang,str(v.published),Number(v.duration_s)||null,
          (({ intro: 1, gate: 2, advanced: 3 } as Record<string, number>)[String(v.level)] ?? Number(v.level)) || null,str(v.why));
        const concepts=Array.isArray(v.concepts) ? v.concepts : Array.isArray(v.timestamps) ? v.timestamps : [];
        for (const item of concepts) {
          const atom=typeof item==='string' ? item : String(item?.atom_id ?? item?.id ?? '');
          if (!atom) continue;
          upConcept.run(id,topic,atom,Math.max(0,Math.round(Number(item?.start_s ?? item?.t ?? 0)||0)),str(item?.note)); add('video_concepts');
        }
        add('videos');
      }
    }

    // ------------------------------------------------------------ 6. review flags for externally-filled answers
    // an external answer stays needs_review=1 until the independent re-solve agrees; a disagreeing re-solve keeps it flagged.
    add("review_cleared", db.run("UPDATE questions SET needs_review=0 WHERE answer_source='external' AND answer<>'' AND answer_check='agrees' AND needs_review=1").changes);
    db.run("UPDATE questions SET answer_source='official' WHERE answer_source IS NULL AND answer<>'' AND source='official'");
    db.run("UPDATE questions SET needs_review=1 WHERE answer_check='disagrees' AND needs_review=0");
  })();

  return { counts, warnings, files };
}

if (import.meta.main) {
  console.log(`import-content into ${config.dataDir}/gate.db`);
  const r = runImportContent();
  console.log(JSON.stringify(r.counts), "files:", JSON.stringify(r.files));
  for (const w of r.warnings) console.warn("warn:", w);
  const n = (sql: string) => (db.query(sql).get() as any).n;
  console.log("unsorted:", n("SELECT COUNT(*) n FROM questions WHERE topic_id='general.unsorted' AND deleted_at IS NULL"),
    "generated:", n("SELECT COUNT(*) n FROM questions WHERE source='generated' AND deleted_at IS NULL"),
    "no-answer:", n("SELECT COUNT(*) n FROM questions WHERE answer='' AND deleted_at IS NULL"));
}
