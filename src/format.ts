import type { Paginated, RunRow, RunDetail, LogRow } from "./hatchet/types.js";

export function formatRunsList(res: Paginated<RunRow>): string {
  if (!res.rows?.length) return "No runs found in the requested window.";
  const lines = res.rows.map((r) => {
    const id = r.metadata?.id ?? r.workflowRunExternalId;
    const err = r.errorMessage ? ` — ${r.errorMessage}` : "";
    return `[${r.status}] ${r.workflowName} (${r.displayName}) id=${id} at ${r.createdAt}${err}`;
  });
  return `${res.rows.length} run(s):\n${lines.join("\n")}`;
}

export function formatRunDetail(res: RunDetail): string {
  const run = res.run;
  const head = `Run ${run.displayName} [${run.status}] workflow=${run.workflowName} id=${run.metadata?.id ?? run.workflowRunExternalId}`;
  const err = run.errorMessage ? `\nerror: ${run.errorMessage}` : "";
  const tasks = (res.tasks ?? [])
    .map((t) => {
      const te = t.errorMessage ? ` — ${t.errorMessage}` : "";
      return `  • ${t.displayName} [${t.status}] id=${t.taskExternalId}${te}`;
    })
    .join("\n");
  const taskBlock = tasks ? `\ntasks:\n${tasks}` : "";
  return `${head}${err}${taskBlock}`;
}

export function formatLogs(res: Paginated<LogRow>): string {
  if (!res.rows?.length) return "No logs for this task.";
  return res.rows.map((l) => `${l.createdAt} [${l.level}] ${l.message}`).join("\n");
}
