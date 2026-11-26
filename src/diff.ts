import type {
  FieldChange,
  Handoff,
  RetainedReference,
  RuleReference,
} from "./contracts.js";
import { markdownText, terminalText } from "./render.js";
import { InputError } from "./validation.js";
import { fieldChanges } from "./verifier.js";

export interface SnapshotDiff {
  schemaVersion: 1;
  status: "unchanged" | "different";
  scope: string;
  projectId?: string;
  beforeCount: number;
  afterCount: number;
  unchangedCount: number;
  changes: {
    id: string;
    kind: "ADDED" | "REMOVED" | "CHANGED";
    before: RuleReference | null;
    after: RuleReference | null;
    fields?: FieldChange[];
  }[];
  notice: string;
}

/** Compare validated declarations only, with no clock or applicability inference. */
export function diffSnapshots(before: Handoff, after: Handoff): SnapshotDiff {
  if (before.schemaVersion === 1 || after.schemaVersion === 1)
    throw new InputError("diff requires content-aware v2/v3/v4 snapshots");
  if (before.scope !== after.scope)
    throw new InputError("diff requires snapshots with the same scope");
  const project = before.schemaVersion === 4 ? before.projectId : undefined;
  if (project !== (after.schemaVersion === 4 ? after.projectId : undefined))
    throw new InputError(
      "diff requires matching project binding on both snapshots",
    );
  const previous = new Map(before.activeConstraints.map((r) => [r.id, r]));
  const current = new Map(after.activeConstraints.map((r) => [r.id, r]));
  const ref = (r: RuleReference): RuleReference => ({
    id: r.id,
    revision: r.revision,
    contentHash: r.contentHash,
  });
  const changes: SnapshotDiff["changes"] = [];
  let unchangedCount = 0;
  for (const id of [
    ...new Set([...previous.keys(), ...current.keys()]),
  ].sort()) {
    const a = previous.get(id);
    const b = current.get(id);
    if (
      a &&
      b &&
      a.revision === b.revision &&
      a.contentHash === b.contentHash
    ) {
      unchangedCount++;
      continue;
    }
    const retained = (r: RuleReference): r is RetainedReference =>
      "content" in r;
    changes.push({
      id,
      kind: !a ? "ADDED" : !b ? "REMOVED" : "CHANGED",
      before: a ? ref(a) : null,
      after: b ? ref(b) : null,
      ...(a && b && retained(a) && retained(b)
        ? { fields: fieldChanges(a.content, b.content) }
        : {}),
    });
  }
  return {
    schemaVersion: 1,
    status: changes.length ? "different" : "unchanged",
    scope: before.scope,
    ...(project === undefined ? {} : { projectId: project }),
    beforeCount: previous.size,
    afterCount: current.size,
    unchangedCount,
    changes,
    notice:
      "Compares declared rules, not agent behavior or current applicability. Task and capture time are metadata and are not compared. Field details require retained content on both sides; additions/removals do not imply why a rule became active or inactive.",
  };
}

export function diffText(result: SnapshotDiff, markdown: boolean): string {
  const safe = markdown ? markdownText : terminalText;
  const lines = [
    markdown ? "# Handoff Check snapshot diff\n" : "SNAPSHOT DIFF",
    `${result.status.toUpperCase()} | scope ${safe(result.scope)}${result.projectId ? ` | project ${safe(result.projectId)}` : ""}`,
    `${result.beforeCount} before | ${result.afterCount} after | ${result.unchangedCount} unchanged`,
  ];
  for (const change of result.changes) {
    lines.push(`${change.kind} ${safe(change.id)}`);
    if (change.kind === "CHANGED") {
      if (change.fields) {
        for (const field of change.fields)
          lines.push(
            `  ${field.field}: ${safe(JSON.stringify(field.before))} -> ${safe(JSON.stringify(field.after))}`,
          );
      } else
        lines.push(
          "  Field details unavailable: both snapshots must retain content",
        );
      lines.push(
        `  Before: revision ${change.before?.revision}, ${change.before?.contentHash}`,
        `  After: revision ${change.after?.revision}, ${change.after?.contentHash}`,
      );
    }
  }
  lines.push(safe(result.notice));
  return `${lines.join(markdown ? "\n\n" : "\n")}\n`;
}
