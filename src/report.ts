import { execFile } from "node:child_process";
import { promisify } from "node:util";
import metadata from "../package.json" with { type: "json" };
import type { VerificationResult } from "./contracts.js";
import { markdownText } from "./render.js";
import { InputError } from "./validation.js";

export interface InputIdentity {
  path: string;
  sha256: string;
}
export async function gitContext(cwd: string) {
  const run = async (args: string[]) =>
    (
      await promisify(execFile)(
        "git",
        ["--no-optional-locks", "-C", cwd, ...args],
        {
          encoding: "utf8",
          timeout: 2000,
          maxBuffer: 262144,
          windowsHide: true,
        },
      )
    ).stdout.replace(/\r?\n$/, "");
  try {
    const worktree = await run(["rev-parse", "--show-toplevel"]);
    const commit = await run(["rev-parse", "--verify", "HEAD"]);
    const name = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
    return { worktree, commit, branch: name === "HEAD" ? null : name };
  } catch {
    throw new InputError(
      "Cannot collect requested Git context; Git and an existing commit in this worktree are required",
    );
  }
}

export function verificationReport(
  result: VerificationResult,
  inputs: {
    manifest: InputIdentity;
    handoff: InputIdentity;
    config: InputIdentity | null;
  },
  policies: { requireContent: boolean; requireActive: boolean },
  profile?: string,
  git?: Awaited<ReturnType<typeof gitContext>>,
) {
  return {
    schemaVersion: 1,
    kind: "verification-report",
    packageVersion: metadata.version,
    policies,
    inputs,
    ...(profile === undefined ? {} : { profile }),
    ...(result.projectId === undefined ? {} : { projectId: result.projectId }),
    ...(git === undefined ? {} : { git }),
    result,
    notice:
      "Local reproducibility record, not an authenticated attestation or proof of agent compliance. Git metadata and input reads are not atomic; revalidate before acting.",
  };
}

export function reportMarkdown(
  report: ReturnType<typeof verificationReport>,
): string {
  const lines = [
    "",
    "## Reproducibility metadata",
    "",
    `- Package: ${markdownText(report.packageVersion)}`,
    `- Profile: ${report.profile === undefined ? "none selected" : markdownText(report.profile)}`,
  ];
  if (report.projectId)
    lines.push(`- Project: ${markdownText(report.projectId)}`);
  for (const [name, input] of Object.entries(report.inputs))
    lines.push(
      input
        ? `- ${name}: ${markdownText(input.path)}; ${markdownText(input.sha256)}`
        : `- ${name}: absent implicit config (no digest)`,
    );
  if (report.git)
    lines.push(
      `- Git worktree: ${markdownText(report.git.worktree)}`,
      `- Git commit: ${markdownText(report.git.commit)}`,
      `- Git branch: ${report.git.branch === null ? "detached" : markdownText(report.git.branch)}`,
    );
  lines.push("", report.notice, "");
  return lines.join("\n");
}
