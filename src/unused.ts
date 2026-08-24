import type { Paginated, RunRow, WorkflowRow } from "./hatchet/types.js";

const WORKFLOW_PAGE = 100;

export interface UnusedWorkflowClient {
  listWorkflows(params: { limit?: number; offset?: number }): Promise<Paginated<WorkflowRow>>;
  listRuns(params: {
    since: string;
    onlyTasks?: boolean;
    workflowIds?: string[];
    limit?: number;
  }): Promise<Paginated<RunRow>>;
}

export interface UnusedWorkflowsResult {
  lookbackDays: number;
  lookbackSince: string;
  workflowCount: number;
  unused: WorkflowRow[];
}

/**
 * Workflows that have had zero runs in the lookback window.
 *
 * Queries each definition with `limit=1` so a high-volume tenant cannot
 * hide a still-active workflow behind a truncated run scan.
 */
export async function findUnusedWorkflows(
  client: UnusedWorkflowClient,
  opts: { lookbackDays?: number } = {},
): Promise<UnusedWorkflowsResult> {
  const lookbackDays = opts.lookbackDays ?? 30;
  const lookbackSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const workflows: WorkflowRow[] = [];
  for (let offset = 0, pages = 0; pages < 50; offset += WORKFLOW_PAGE, pages++) {
    const page = await client.listWorkflows({ limit: WORKFLOW_PAGE, offset });
    const rows = page.rows ?? [];
    workflows.push(...rows);
    if (rows.length < WORKFLOW_PAGE) break;
  }

  const unused: WorkflowRow[] = [];
  for (const wf of workflows) {
    const id = wf.metadata?.id;
    if (!id) {
      unused.push(wf);
      continue;
    }
    const runs = await client.listRuns({
      since: lookbackSince,
      workflowIds: [id],
      limit: 1,
      onlyTasks: false,
    });
    if (!runs.rows?.length) unused.push(wf);
  }

  unused.sort((a, b) => a.name.localeCompare(b.name));

  return {
    lookbackDays,
    lookbackSince,
    workflowCount: workflows.length,
    unused,
  };
}

export function formatUnusedWorkflows(res: UnusedWorkflowsResult): string {
  const head =
    `Lookback: ${res.lookbackDays} day(s) (since ${res.lookbackSince})\n` +
    `Tenant workflows: ${res.workflowCount}\n` +
    `Unused (no runs in window): ${res.unused.length}`;
  if (!res.unused.length) {
    return `${head}\n\nNo unused workflow definitions in this window.`;
  }
  const lines = res.unused.map((w) => {
    const id = w.metadata?.id ?? "(missing id)";
    const created = w.metadata?.createdAt ? ` created=${w.metadata.createdAt}` : "";
    return `- ${w.name}  id=${id}${created}`;
  });
  return (
    `${head}\n\n${lines.join("\n")}\n\n` +
    "Permanently remove a definition with delete_workflow (workflowId + confirm=true). " +
    "That also drops cron schedules on the definition. Cancel in-flight runs first if any are still queued."
  );
}
