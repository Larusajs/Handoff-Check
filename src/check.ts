import type { Handoff, VerificationResult } from "./contracts.js";
import { markdownText, terminalText, verificationMarkdown } from "./render.js";
import type { ReviewResult } from "./review.js";
import { reviewText } from "./review.js";
import type { SourceResult } from "./sources.js";
import { sourceText } from "./sources.js";

export type Section<T> =
  | { status: "passed" | "attention"; result: T }
  | { status: "invalid"; error: string }
  | { status: "not-requested" };
export interface CombinedCheck {
  schemaVersion: 1;
  kind: "combined-check";
  status: "passed" | "attention" | "invalid";
  scope: string;
  asOf: string;
  profile?: string;
  projectId?: string;
  activeConstraintCount: number;
  policy: { requireContent: true; requireActive: true };
  checks: {
    verification: Exclude<
      Section<VerificationResult>,
      { status: "not-requested" }
    >;
    review: Section<ReviewResult>;
    sources: Section<SourceResult>;
  };
  summary: {
    requestedChecks: number;
    passedChecks: number;
    attentionChecks: number;
    invalidChecks: number;
    notRequestedChecks: number;
  };
  notice: string;
}

export function combineChecks(
  context: Pick<
    CombinedCheck,
    "scope" | "asOf" | "profile" | "projectId" | "activeConstraintCount"
  >,
  checks: CombinedCheck["checks"],
): CombinedCheck {
  const sections = Object.values(checks);
  const count = (status: Section<unknown>["status"]) =>
    sections.filter((s) => s.status === status).length;
  const summary = {
    requestedChecks: 3 - count("not-requested"),
    passedChecks: count("passed"),
    attentionChecks: count("attention"),
    invalidChecks: count("invalid"),
    notRequestedChecks: count("not-requested"),
  };
  return {
    schemaVersion: 1,
    kind: "combined-check",
    status: summary.invalidChecks
      ? "invalid"
      : summary.attentionChecks
        ? "attention"
        : "passed",
    ...context,
    policy: { requireContent: true, requireActive: true },
    checks,
    summary,
    notice:
      "Local checks of declarations and explicitly selected metadata, not authorization or proof of behavior. Not-requested sections were not checked. Reads and source observations are not atomic; no inputs or baselines are changed.",
  };
}

export function combinedText(
  report: CombinedCheck,
  markdown: boolean,
  handoff?: Handoff,
): string {
  const safe = markdown ? markdownText : terminalText;
  const lines = [
    markdown ? "# Handoff Check combined check" : "COMBINED CHECK",
    `${report.status.toUpperCase()} | scope ${safe(report.scope)} | as of ${safe(report.asOf)} | ${report.activeConstraintCount} active constraints`,
    `${report.summary.requestedChecks} requested | ${report.summary.passedChecks} passed | ${report.summary.attentionChecks} attention | ${report.summary.invalidChecks} invalid | ${report.summary.notRequestedChecks} not requested`,
  ];
  for (const [name, section] of Object.entries(report.checks)) {
    lines.push(
      `${markdown ? "## " : ""}${name}: ${section.status.toUpperCase()}`,
    );
    if (section.status === "invalid") lines.push(safe(section.error));
    else if ("result" in section) {
      if (name === "review")
        lines.push(reviewText(section.result as ReviewResult, markdown));
      else if (name === "sources")
        lines.push(sourceText(section.result as SourceResult, markdown));
      else {
        const result = section.result as VerificationResult;
        if (markdown && handoff)
          lines.push(verificationMarkdown(result, handoff, true, true));
        else {
          lines.push(
            `${result.status.toUpperCase()} | ${result.expectedConstraints.length} active constraints`,
          );
          for (const finding of result.findings)
            lines.push(
              `${finding.code}${finding.id ? ` ${safe(finding.id)}` : ""} ${safe(finding.message)}`,
            );
        }
      }
    }
  }
  lines.push(report.notice);
  return `${lines.join(markdown ? "\n\n" : "\n")}\n`;
}
