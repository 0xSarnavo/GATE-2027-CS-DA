import { test, expect } from "bun:test";
import { resolveModules } from "../modules/config";
import { generatePlan } from "../modules/planner/generate";

test("module config and env preserve registry order and reject unknown ids", () => {
  expect(resolveModules(["jobs", "planner"])).toEqual(["planner", "jobs"]);
  expect(resolveModules(["jobs"], "practice,planner")).toEqual(["planner", "practice"]);
  expect(() => resolveModules([], "unknown")).toThrow();
});
test("planner respects paper, order, breaks and fixed routine", () => {
  const plan = generatePlan({ papers: "CS", startDate: "2026-10-07", examDate: "2026-10-21", weekdayHours: 2, weekendHours: 1,
    routineBlocks: [{ label: "College", days: [3], start: "09:00", end: "12:00" }], breaks: [{ start: "2026-10-08", end: "2026-10-08" }] },
  [{ id: "root", name: "Root", paper: "shared" }, { id: "da", name: "DA topic", parent_id: "root", paper: "DA" }, { id: "cs", name: "CS topic", parent_id: "root", paper: "CS" }, { id: "both", name: "Shared topic", parent_id: "root", paper: "shared" }]);
  expect(plan.days).toHaveLength(15);
  expect(plan.days[0].tasks[0]).toMatchObject({ title: "College", fixed: 1, minutes: 180 });
  expect(plan.days[0].tasks.find(t => t.topic_id)?.topic_id).toBe("cs");
  expect(plan.days[1].kind).toBe("light");
  expect(plan.days[1].tasks.filter(t => !t.fixed).reduce((n, t) => n + t.minutes, 0)).toBe(30);
  expect(plan.days.flatMap(d => d.tasks).some(t => t.topic_id === "da")).toBe(false);
  expect(plan.weeks[0].start).toBe("2026-10-07");
  expect(() => generatePlan({ papers: "CS", startDate: "2026-10-21", examDate: "2026-10-07", weekdayHours: 2, weekendHours: 2 }, [])).toThrow();
});
test('planner generates Gym as a reminder without study minutes', () => {
  const plan = generatePlan({ papers: 'CS', startDate: '2026-10-07', examDate: '2026-10-08', weekdayHours: 1, weekendHours: 1,
    routineBlocks: [{ label: 'Gym', days: [3], start: '17:00', end: '19:00' }] },
  [{ id: 'root', name: 'Root', paper: 'shared' }, { id: 'chapter', name: 'Chapter', parent_id: 'root', paper: 'CS' }]);
  expect(plan.days[0].tasks[0]).toMatchObject({ title: 'Gym', type: 'gym', minutes: 0, time_block: '17:00-19:00' });
});
