import { createHash } from "node:crypto";
import type { Constraint, RuleReference } from "./contracts.js";

/** Canonical content contract v1. Revision is compared separately. */
export function reference(rule: Constraint): RuleReference {
  const instant = (value: string | undefined) =>
    value === undefined ? null : new Date(value).toISOString();
  const content = JSON.stringify({
    id: rule.id,
    scope: rule.scope,
    description: rule.description,
    source: rule.source,
    expiresAt: instant(rule.expiresAt),
    revokedAt: instant(rule.revokedAt),
    replacedBy: rule.replacedBy ?? null,
    supersededAt: instant(rule.supersededAt),
  });
  return {
    id: rule.id,
    revision: rule.revision ?? 1,
    contentHash: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
  };
}
