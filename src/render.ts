import type { Explanation, Handoff, VerificationResult } from "./contracts.js";

/** Keep untrusted data on one terminal line, including bidi/format controls. */
export function terminalText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : character;
  }).join("");
}

/** Numeric entities prevent data from becoming Markdown structure or HTML. */
export function markdownText(value: string): string {
  return terminalText(value).replace(
    /[&<>\\`*_{}[\]()#+.!|~:/@-]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

export function verificationMarkdown(
  result: VerificationResult,
  handoff: Handoff,
  requireActive: boolean,
  requireContent: boolean,
): string {
  const label =
    result.status === "verified"
      ? result.expectedConstraints.length
        ? "PASS"
        : "PASS (EMPTY)"
      : "FAIL";
  const lines = [
    "# Handoff Check verification",
    "",
    `- Result: ${label}`,
    `- Scope: ${markdownText(result.scope)}`,
    ...(result.projectId === undefined
      ? []
      : [`- Project: ${markdownText(result.projectId)}`]),
    `- Evaluated at: ${markdownText(result.asOf)}`,
    `- Active constraints checked: ${result.expectedConstraints.length}`,
    `- Tracking: ${handoff.schemaVersion === 1 ? "IDs only; content changes not checked" : handoff.schemaVersion === 3 || (handoff.schemaVersion === 4 && handoff.contentMode === "retained") ? "Content hashes with retained old content" : "Content hashes; old content not retained"}`,
    `- Require content-aware handoff: ${requireContent}`,
    `- Require active constraints: ${requireActive}`,
    "",
  ];
  if (!result.expectedConstraints.length)
    lines.push("No active constraints apply to this scope and time.", "");
  lines.push("## Findings", "");
  if (!result.findings.length) lines.push("No findings.", "");
  for (const finding of result.findings) {
    lines.push(
      `### ${finding.code}${finding.id === undefined ? "" : ` ${markdownText(finding.id)}`}`,
      "",
      markdownText(finding.message),
      "",
    );
    if (finding.code === "CHANGED") {
      if (finding.changes) {
        lines.push(
          "| Field | Before (saved) | After (current) |",
          "| --- | --- | --- |",
        );
        for (const change of finding.changes)
          lines.push(
            `| ${change.field} | ${markdownText(JSON.stringify(change.before))} | ${markdownText(JSON.stringify(change.after))} |`,
          );
        lines.push("", "Null means an absent optional field.", "");
      } else
        lines.push(
          "Previous content unavailable: this baseline stores hashes only. No textual diff can be reconstructed.",
          "",
        );
    }
  }
  lines.push(
    "A pass checks declared constraints, not agent behavior or action authorization.",
  );
  return `${lines.join("\n")}\n`;
}

export function explanationText(
  result: Explanation,
  markdown: boolean,
): string {
  if (markdown) {
    return [
      "# Handoff Check explanation",
      "",
      `- Scope: ${markdownText(result.scope)}`,
      ...(result.projectId === undefined
        ? []
        : [`- Project: ${markdownText(result.projectId)}`]),
      `- Evaluated at: ${markdownText(result.asOf)}`,
      `- Active constraints: ${result.activeConstraintCount}`,
      "",
      "| ID | Rule scope | Decision | Reason | Description | Source |",
      "| --- | --- | --- | --- | --- | --- |",
      ...result.rules.map(
        (rule) =>
          `| ${[rule.id, rule.scope, rule.decision, rule.reason, rule.description, rule.source].map(markdownText).join(" | ")} |`,
      ),
      "",
      "Explains manifest applicability only; no handoff was compared.",
      "",
    ].join("\n");
  }
  return [
    ...result.rules.map(
      (rule) =>
        `${rule.decision.padEnd(12)} ${rule.id}  ${terminalText(rule.reason)}; ${terminalText(rule.description)}; source ${terminalText(rule.source)}`,
    ),
    `EXPLAIN  ${result.activeConstraintCount} active constraints | ${result.rules.length} manifest rules | scope ${result.scope} | as of ${result.asOf}${result.projectId === undefined ? "" : ` | project ${result.projectId}`}`,
    "No handoff was compared.",
    "",
  ].join("\n");
}
