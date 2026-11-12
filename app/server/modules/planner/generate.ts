export type PaperChoice = "CS" | "DA" | "both";
export interface RoutineBlock { label: string; days: number[]; start: string; end: string }
export interface BreakPeriod { label?: string; start: string; end: string }
export interface PlanInput {
  papers: PaperChoice; startDate: string; examDate: string; weekdayHours: number; weekendHours: number;
  routineBlocks?: RoutineBlock[]; breaks?: BreakPeriod[];
}
export interface Topic { id: string; name: string; paper: string; parent_id?: string | null }
export interface GeneratedTask { title: string; subject: string; type: string; topic_id: string | null; minutes: number; priority: number; fixed: number; time_block?: string }
export interface GeneratedPlan {
  phases: { id: string; name: string; start: string; end: string; description: string }[];
  weeks: { week_no: number; start: string; end: string; phase_id: string; label: string; macro_goals: { text: string; done: boolean }[] }[];
  days: { date: string; tasks: GeneratedTask[]; kind: "normal" | "light" }[];
}
const ms = (s: string) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const value = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === s ? value : NaN;
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const day = 86400_000;
const minutes = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const validTime = (hm: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hm) || hm === "24:00";
export function generatePlan(input: PlanInput, topics: readonly Topic[]): GeneratedPlan {
  if (!Number.isFinite(ms(input.startDate)) || !Number.isFinite(ms(input.examDate)) || ms(input.examDate) <= ms(input.startDate)) throw new Error("Exam date must follow start date");
  if (![input.weekdayHours, input.weekendHours].every(x => Number.isFinite(x) && x >= 0 && x <= 16)) throw new Error("Study hours must be from 0 to 16");
  for (const b of input.routineBlocks ?? []) {
    if (!b.label?.trim() || !Array.isArray(b.days) || b.days.some(x => !Number.isInteger(x) || x < 0 || x > 6) || !validTime(b.start) || !validTime(b.end) || minutes(b.end) <= minutes(b.start) || minutes(b.end) > 1440) throw new Error("Invalid routine block");
  }
  for (const b of input.breaks ?? []) if (!Number.isFinite(ms(b.start)) || !Number.isFinite(ms(b.end)) || ms(b.end) < ms(b.start)) throw new Error("Invalid break period");
  const leaves = topics.filter(t => t.parent_id && (t.paper === "shared" || t.paper === "GA" || input.papers === "both" || t.paper === input.papers));
  if (!leaves.length) throw new Error("Content pack has no topics for these papers");
  const total = Math.floor((ms(input.examDate) - ms(input.startDate)) / day) + 1;
  const phaseDefs = [
    { id: "foundation", name: "Foundation", end: Math.max(1, Math.floor(total * .15)) },
    { id: "coverage", name: "Topic coverage", end: Math.max(2, Math.floor(total * .75)) },
    { id: "revision", name: "Revision and mocks", end: total },
  ].filter((p, i, a) => i === 0 || p.end > a[i - 1].end);
  const phases = phaseDefs.map((p, i) => ({ id: p.id, name: p.name, start: iso(ms(input.startDate) + (i ? phaseDefs[i - 1].end : 0) * day), end: iso(ms(input.startDate) + (p.end - 1) * day), description: p.name }));
  const days: GeneratedPlan["days"] = [];
  let topicIndex = 0;
  for (let i = 0; i < total; i++) {
    const date = iso(ms(input.startDate) + i * day);
    const dow = new Date(ms(date)).getUTCDay();
    const inBreak = (input.breaks ?? []).some(b => b.start <= date && date <= b.end);
    const budget = Math.round((dow === 0 || dow === 6 ? input.weekendHours : input.weekdayHours) * 60 * (inBreak ? .25 : 1));
    const phase = phases.find(p => p.start <= date && date <= p.end)!;
    const tasks: GeneratedTask[] = [];
    for (const block of input.routineBlocks ?? []) if (block.days.includes(dow)) tasks.push({ title: block.label, subject: "routine", type: /^gym$/i.test(block.label.trim()) ? "gym" : "study", topic_id: null, minutes: /^gym$/i.test(block.label.trim()) ? 0 : minutes(block.end) - minutes(block.start), priority: 2, fixed: 1, time_block: `${block.start}-${block.end}` });
    if (budget >= 15) {
      const review = phase.id === "revision" ? Math.min(45, Math.round(budget * .3)) : Math.min(30, Math.round(budget * .15));
      const n = Math.max(1, Math.ceil((budget - review) / 90));
      const base = Math.floor((budget - review) / n);
      for (let j = 0; j < n; j++) {
        const topic = leaves[topicIndex++ % leaves.length];
        const m = j === n - 1 ? budget - review - base * (n - 1) : base;
        if (m > 0) tasks.push({ title: `${phase.id === "revision" ? "Revise" : "Study"}: ${topic.name}`, subject: topic.paper, type: phase.id === "revision" ? "revision" : "study", topic_id: topic.id, minutes: m, priority: j ? 2 : 1, fixed: 0 });
      }
      if (review) tasks.push({ title: "Flashcards and mistakes", subject: "shared", type: "revision", topic_id: null, minutes: review, priority: 2, fixed: 0 });
    }
    days.push({ date, tasks, kind: inBreak ? "light" : "normal" });
  }
  const weeks: GeneratedPlan["weeks"] = [];
  for (let i = 0; i < total; i += 7) {
    const span = days.slice(i, i + 7), start = span[0].date, end = span.at(-1)!.date;
    const phase = phases.find(p => p.start <= start && start <= p.end) ?? phases.at(-1)!;
    const names = [...new Set(span.flatMap(d => d.tasks.filter(t => t.topic_id).map(t => t.title.split(": ")[1])))];
    weeks.push({ week_no: weeks.length + 1, start, end, phase_id: phase.id, label: `Week ${weeks.length + 1}`, macro_goals: [{ text: names.length ? `Cover ${names.slice(0, 4).join(", ")}` : "Keep a light study rhythm", done: false }] });
  }
  return { phases, weeks, days };
}
