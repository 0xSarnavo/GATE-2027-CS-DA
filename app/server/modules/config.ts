export const moduleIds = ["planner", "practice", "learn", "review", "mocks", "habits", "jobs", "insights"] as const;
export type ModuleId = typeof moduleIds[number];
export function resolveModules(configured: readonly string[], env?: string): ModuleId[] {
  const selected = env === undefined ? configured : env.split(",").map(x => x.trim());
  const unknown = selected.filter(x => x && !moduleIds.includes(x as ModuleId));
  if (unknown.length) throw new Error(`Unknown modules: ${unknown.join(", ")}`);
  return moduleIds.filter(id => selected.includes(id));
}
