import { describe, it, expect } from "vitest";
import { formatRunsList, formatRunDetail, formatLogs } from "../src/format.js";
import runs from "./fixtures/runs.json" with { type: "json" };
import runDetail from "./fixtures/run-detail.json" with { type: "json" };
import logs from "./fixtures/logs.json" with { type: "json" };

describe("formatRunsList", () => {
  it("renders one compact line per run with id, status, name", () => {
    const out = formatRunsList(runs as any);
    expect(out).toContain("transcribe-batch-mlx");
    expect(out).toContain("QUEUED");
    expect(out).toContain("e6150bc5-086e-4751-b1ba-a800bb48ff9b");
  });

  it("reports an empty result clearly", () => {
    expect(formatRunsList({ rows: [] } as any)).toMatch(/no runs/i);
  });
});

describe("formatRunDetail", () => {
  it("summarizes run status and per-task status + error", () => {
    const out = formatRunDetail(runDetail as any);
    expect(out).toContain("FAILED");
    expect(out).toContain("step-a");
    expect(out).toContain("boom");
  });

  it("handles a missing run gracefully", () => {
    expect(formatRunDetail({} as any)).toMatch(/not found/i);
  });

  it("omits workflow= when the detail run has no workflowName", () => {
    const out = formatRunDetail({ run: { metadata: { id: "r1" }, displayName: "d", status: "RUNNING" } } as any);
    expect(out).not.toContain("undefined");
    expect(out).toContain("[RUNNING]");
  });
});

describe("formatLogs", () => {
  it("renders level + message per line", () => {
    const out = formatLogs(logs as any);
    expect(out).toContain("INFO");
    expect(out).toContain("No pending refresh requests");
  });

  it("reports empty logs clearly", () => {
    expect(formatLogs({ rows: [] } as any)).toMatch(/no logs/i);
  });
});
