export interface Paginated<T> {
  pagination?: { current_page?: number; next_page?: number; num_pages?: number };
  rows: T[];
}

export interface ApiMeta {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowRow {
  metadata: ApiMeta;
  name: string;
  description?: string;
}

// A row from /stable/tenants/{t}/workflow-runs (verified shape).
export interface RunRow {
  metadata: ApiMeta;
  displayName: string;
  status: string;
  workflowName: string;
  workflowId: string;
  taskExternalId: string;
  workflowRunExternalId: string;
  errorMessage?: string;
  createdAt: string;
  type?: string;
  additionalMetadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
}

// /stable/workflow-runs/{id} consolidated detail.
export interface RunDetail {
  run: RunRow;
  shape?: unknown;
  tasks?: RunRow[];
  taskEvents?: unknown[];
  workflowConfig?: unknown;
}

export interface LogRow {
  message: string;
  level: string;
  createdAt: string;
  attempt?: number;
  taskDisplayName?: string;
  taskExternalId?: string;
}

export interface WorkerRow {
  metadata?: ApiMeta;
  name?: string;
  status?: string;
  lastHeartbeatAt?: string;
}

export interface ListRunsParams {
  since: string; // required by the API
  onlyTasks?: boolean; // maps to only_tasks (default false)
  until?: string;
  statuses?: string[];
  workflowIds?: string[];
  limit?: number;
  offset?: number;
  includePayloads?: boolean;
  additionalMetadata?: string[];
}
