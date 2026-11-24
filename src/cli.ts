#!/usr/bin/env node
import { type FileHandle, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import metadata from "../package.json" with { type: "json" };
import { loadConfig, readJson } from "./config.js";
import { initialize } from "./initialize.js";
import {
  explanationText,
  terminalText,
  verificationMarkdown,
} from "./render.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
  timestamp,
} from "./validation.js";
import { explain, snapshot, verify } from "./verifier.js";

const help = `Handoff Check

Usage: handoff-check verify --scope <scope> [options]
       handoff-check init --scope <scope> [--agent both] [--dry-run] [--ci]
       handoff-check snapshot --task <task> [--output <new-file>] [options]
       handoff-check explain --scope <scope> [options]

Options:
  --constraints <path>  Manifest file (default: constraints.json)
  --handoff <path>      Handoff file (default: handoff.json)
  --scope <scope>       Selected scope, including global constraints
  --config <path>       Project config (default: cwd/.handoff-check.json)
  --as-of <UTC time>    Fixed evaluation time (default: current time)
  --require-content    verify: require a v2/v3 content-aware handoff
  --require-active     verify: fail if no constraints apply to scope/time
  --task <task>        snapshot: task description (required)
  --output <path>      snapshot: create a new baseline file, never overwrite
  --include-content    snapshot: retain old rule text in a v3 handoff (opt-in)
  --format text|json|markdown  Markdown is verify/explain-only (default: text)
  --agent <agent>      init: codex, claude, both (default), or none
  --dry-run            init: preview files and instruction changes without writes
  --ci                 init: also create a pinned GitHub Actions check
  --version            Show package version
  --help               Show this help

Exit codes: 0 verified/explained/captured/initialized, 1 rule/policy mismatch, 2 invalid input
`;

async function main(): Promise<number> {
  let format = "text";
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        constraints: { type: "string" },
        handoff: { type: "string" },
        scope: { type: "string" },
        config: { type: "string" },
        "as-of": { type: "string" },
        format: { type: "string", default: "text" },
        help: { type: "boolean" },
        version: { type: "boolean" },
        agent: { type: "string" },
        "dry-run": { type: "boolean" },
        ci: { type: "boolean" },
        "require-content": { type: "boolean" },
        "require-active": { type: "boolean" },
        "include-content": { type: "boolean" },
        task: { type: "string" },
        output: { type: "string" },
      },
    });
    format = values.format;
    if (!["text", "json", "markdown"].includes(format))
      throw new InputError("--format: expected text, json or markdown");
    if (values.help) {
      process.stdout.write(help);
      return 0;
    }
    if (values.version) {
      process.stdout.write(`${metadata.version}\n`);
      return 0;
    }
    if (
      positionals.length !== 1 ||
      !["verify", "init", "snapshot", "explain"].includes(positionals[0] ?? "")
    )
      throw new InputError(
        "Expected command: verify, snapshot, explain or init (use --help for usage)",
      );
    const cwd = process.cwd();
    const command = positionals[0];
    if (format === "markdown" && command !== "verify" && command !== "explain")
      throw new InputError(
        "--format markdown is only supported by verify and explain",
      );
    if (values["include-content"] !== undefined && command !== "snapshot")
      throw new InputError("--include-content is only supported by snapshot");
    if (
      command === "explain" &&
      [
        values.handoff,
        values.task,
        values.output,
        values["require-content"],
        values["require-active"],
      ].some((value) => value !== undefined)
    )
      throw new InputError(
        "--handoff, --task, --output and --require-* are not supported by explain",
      );
    if (positionals[0] === "init") {
      for (const key of [
        "constraints",
        "handoff",
        "config",
        "as-of",
        "require-content",
        "require-active",
        "task",
        "output",
      ] as const)
        if (values[key] !== undefined)
          throw new InputError(`--${key} is not supported by init`);
      const result = await initialize(cwd, {
        ...(values.scope === undefined ? {} : { scope: values.scope }),
        agent: values.agent ?? "both",
        dryRun: values["dry-run"] ?? false,
        ci: values.ci ?? false,
      });
      if (format === "json")
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        for (const file of result.files)
          process.stdout.write(
            `${values["dry-run"] ? "PLAN " : ""}${file.action.toUpperCase()}  ${terminalText(file.path)}\n`,
          );
        if (values["dry-run"])
          for (const file of result.files)
            if (file.content !== undefined)
              process.stdout.write(
                `\n--- ${terminalText(file.path)} ---\n${file.content.split("\n").map(terminalText).join("\n")}\n`,
              );
        process.stdout.write(
          `${result.status.toUpperCase()} | scope ${result.scope}\n${result.notice}\n`,
        );
      }
      return 0;
    }
    if (
      values.agent !== undefined ||
      values["dry-run"] !== undefined ||
      values.ci !== undefined
    )
      throw new InputError(
        "--agent, --dry-run and --ci are only supported by init",
      );
    const { config, directory } = await loadConfig(cwd, values.config);
    const scope = identifier(
      values.scope ?? config.scope,
      "--scope (or config.scope)",
    );
    const asOf = values["as-of"] ?? new Date().toISOString();
    timestamp(asOf, "--as-of");
    for (const key of ["constraints", "handoff", "config"] as const)
      if (values[key] !== undefined && !values[key].trim())
        throw new InputError(`--${key}: expected a non-empty path`);
    const manifest = parseManifest(
      await readJson(
        values.constraints !== undefined
          ? resolve(cwd, values.constraints)
          : resolve(directory, config.constraints ?? "constraints.json"),
      ),
    );
    if (command === "explain") {
      const result = explain(manifest, scope, asOf);
      process.stdout.write(
        format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : explanationText(result, format === "markdown"),
      );
      return 0;
    }
    if (positionals[0] === "snapshot") {
      if (
        values.handoff !== undefined ||
        values["require-content"] !== undefined ||
        values["require-active"] !== undefined
      )
        throw new InputError(
          "--handoff, --require-content and --require-active are only supported by verify",
        );
      if (values.task === undefined)
        throw new InputError("snapshot requires --task");
      const captured = snapshot(manifest, values.task, scope, asOf, {
        includeContent: values["include-content"] ?? false,
      });
      const content = `${JSON.stringify(captured, null, 2)}\n`;
      if (values.output === undefined) process.stdout.write(content);
      else {
        if (!values.output.trim())
          throw new InputError("--output: expected a non-empty path");
        const path = resolve(cwd, values.output);
        let handle: FileHandle;
        try {
          handle = await open(path, "wx", 0o644);
        } catch {
          throw new InputError(
            `Cannot create snapshot '${path}'; choose a new file with an existing parent directory`,
          );
        }
        try {
          await handle.writeFile(content, "utf8");
        } finally {
          await handle.close();
        }
        const saved = {
          schemaVersion: 1,
          status: "captured",
          path,
          constraints: captured.activeConstraints.length,
        };
        process.stdout.write(
          format === "json"
            ? `${JSON.stringify(saved)}\n`
            : `CAPTURED  ${terminalText(path)}\n`,
        );
      }
      return 0;
    }
    if (values.task !== undefined || values.output !== undefined)
      throw new InputError(
        "--task and --output are only supported by snapshot",
      );
    const handoff = parseHandoff(
      await readJson(
        values.handoff !== undefined
          ? resolve(cwd, values.handoff)
          : resolve(directory, config.handoff ?? "handoff.json"),
      ),
    );
    if (values["require-content"] && handoff.schemaVersion === 1)
      throw new InputError(
        "Content tracking requires a schemaVersion 2 or 3 handoff; review current rules and capture a snapshot before resuming",
      );
    const result = verify(manifest, handoff, scope, asOf, {
      requireActive: values["require-active"] ?? false,
    });
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (format === "markdown") {
      process.stdout.write(
        verificationMarkdown(
          result,
          handoff,
          values["require-active"] ?? false,
          values["require-content"] ?? false,
        ),
      );
    } else {
      for (const finding of result.findings) {
        process.stdout.write(
          `${finding.code.padEnd(12)} ${finding.id === undefined ? "" : `${finding.id}  `}${terminalText(finding.message)}\n`,
        );
        if (finding.code === "CHANGED") {
          if (finding.changes)
            for (const change of finding.changes)
              process.stdout.write(
                `  ${change.field}: ${terminalText(JSON.stringify(change.before))} -> ${terminalText(JSON.stringify(change.after))}\n`,
              );
          else
            process.stdout.write(
              "  Previous content unavailable: baseline stores hashes only\n",
            );
        }
      }
      const count = result.expectedConstraints.length;
      const label =
        result.status === "verified"
          ? count === 0
            ? "PASS (EMPTY)"
            : "PASS"
          : "FAIL";
      process.stdout.write(
        `${label}  ${count} active constraints checked | ${result.findings.length} findings | scope ${scope} | as of ${result.asOf}${handoff.schemaVersion === 1 ? " | IDs only; content changes not checked" : " | content tracked"}${count === 0 ? " | No active constraints apply to this scope and time" : ""}\n`,
      );
    }
    return result.status === "verified" ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected failure";
    if (format === "json")
      process.stderr.write(
        `${JSON.stringify({ schemaVersion: 1, status: "invalid", error: message })}\n`,
      );
    else process.stderr.write(`INVALID  ${terminalText(message)}\n`);
    return 2;
  }
}

process.exitCode = await main();
