#!/usr/bin/env node
import { type FileHandle, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import metadata from "../package.json" with { type: "json" };
import { loadConfig, readJsonRecord, selectProfile } from "./config.js";
import { diffSnapshots, diffText } from "./diff.js";
import { doctor } from "./doctor.js";
import { initialize } from "./initialize.js";
import { hookConfig, lifecycleHook, readHookInput } from "./lifecycle.js";
import {
  explanationText,
  terminalText,
  verificationMarkdown,
} from "./render.js";
import { gitContext, reportMarkdown, verificationReport } from "./report.js";
import { reviewCommand } from "./review-cli.js";
import { runVerified } from "./run.js";
import { guidedSetup } from "./setup.js";
import { sourceCommand } from "./source-cli.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
  timestamp,
} from "./validation.js";
import { checkProject, explain, snapshot, verify } from "./verifier.js";

const help = `Handoff Check

Usage: handoff-check verify --scope <scope> [options]
       handoff-check source-check --sources <source-registry> [options]
       handoff-check source-record --bindings <binding-plan> [--output <new-file>] [options]
       handoff-check review --registry <review-file> [--profile <name>] [--format text|json|markdown]
       handoff-check review-record --owner <owner> --review-by <UTC time> [--output <new-file>] [options]
       handoff-check run [--profile <name> | --scope <scope>] [--config <path>] -- <executable> [args...]
       handoff-check diff --before <snapshot> --after <snapshot> [--format text|json|markdown]
       handoff-check setup [--dry-run]
       handoff-check init --scope <scope> [--agent both] [--dry-run] [--ci]
       handoff-check snapshot --task <task> [--output <new-file>] [options]
       handoff-check explain --scope <scope> [options]
       handoff-check doctor [--host claude|codex|cursor] [--format text|json]
       handoff-check hook-config --host claude [--require-active]
       handoff-check hook --host claude --config <absolute-path> [--require-active]

Options:
  --sources <path>      source-check: explicit local-source registry (cwd relative)
  --bindings <path>     source-record: explicit rule/path binding plan (cwd relative)
  --registry <path>     review: explicit review registry (resolved from cwd)
  --owner <owner>       review-record: owner of explicitly reviewed active rules
  --review-by <UTC>     review-record: review deadline, later than capture time
  --before <path>       diff: saved snapshot before the change
  --after <path>        diff: saved snapshot after the change
  --constraints <path>  Manifest file (default: constraints.json)
  --handoff <path>      Handoff file (default: handoff.json)
  --scope <scope>       Selected scope, including global constraints
  --config <path>       Project config (default: cwd/.handoff-check.json)
  --profile <name>      Explicit config v2 profile; no scope/input overrides
  --report              verify: exact input/config metadata (json/markdown only)
  --git-context         verify --report: collect read-only Git context explicitly
  --as-of <UTC time>    Fixed evaluation time (default: current time)
  --require-content    verify: require a v2/v3/v4 content-aware handoff
  --require-active     verify: fail if empty; hook/hook-config: opt-in nonempty policy
  --task <task>        snapshot: task description (required)
  --output <path>      snapshot/review-record/source-record: new file, never overwrite
  --include-content    snapshot: retain old rule text in unbound v3/bound v4 (opt-in)
  --format text|json|markdown  Markdown: verify/explain/diff/review/source-check (default: text)
  --agent <agent>      init: codex, claude, both (default), or none
  --host <host>        doctor: integration target; hook/hook-config: claude
  --dry-run            init/setup: preview proposed files without writes
  --ci                 init: also create a pinned GitHub Actions check
  --version            Show package version
  --help               Show this help

Exit codes: verify 0 verified / 1 mismatch; diff 0 unchanged / 1 different; doctor 0 healthy / 1 attention.
Review: 0 current maintenance / 1 attention (including zero active); never changes verify/run policy.
Source-check: 0 unchanged / 1 attention (including zero active); no implicit source reads by verify/run.
Run: mandatory content/nonempty/current-clock preflight; 1 blocked / 2 invalid or launch error.
After launch run returns the child exit code (or 128 + signal); diagnostics use stderr.
Hook 0 means advisory response delivered (may report FAIL/INVALID), not verified.
Invalid invocation/input returns 2; explain/init/snapshot/hook-config succeed with 0.
`;

async function main(): Promise<number> {
  let format = "text";
  try {
    const rawArgs = process.argv.slice(2);
    const runCommand = rawArgs[0] === "run";
    const separator = rawArgs.indexOf("--");
    const wrapperArgs =
      runCommand && separator >= 0 ? rawArgs.slice(0, separator) : rawArgs;
    const { values, positionals } = parseArgs({
      args: wrapperArgs,
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
        host: { type: "string" },
        profile: { type: "string" },
        report: { type: "boolean" },
        "git-context": { type: "boolean" },
        task: { type: "string" },
        output: { type: "string" },
        before: { type: "string" },
        after: { type: "string" },
        registry: { type: "string" },
        owner: { type: "string" },
        "review-by": { type: "string" },
        sources: { type: "string" },
        bindings: { type: "string" },
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
      ![
        "verify",
        "init",
        "snapshot",
        "explain",
        "doctor",
        "hook",
        "hook-config",
        "diff",
        "setup",
        "run",
        "review",
        "review-record",
        "source-check",
        "source-record",
      ].includes(positionals[0] ?? "")
    )
      throw new InputError(
        "Expected command: verify, snapshot, explain, init, setup, diff, run, review, review-record, source-check, source-record, doctor, hook or hook-config (use --help for usage)",
      );
    const cwd = process.cwd();
    const command = positionals[0];
    if (command === "source-check" || command === "source-record") {
      const allowed = [
        "config",
        "profile",
        "scope",
        "constraints",
        "as-of",
        "format",
        ...(command === "source-check" ? ["sources"] : ["bindings", "output"]),
      ];
      for (const key of Object.keys(values))
        if (!allowed.includes(key))
          throw new InputError(`--${key} is not supported by ${command}`);
      return await sourceCommand(cwd, command, values);
    }
    if (values.sources !== undefined || values.bindings !== undefined)
      throw new InputError(
        "--sources and --bindings are source-check/source-record-only",
      );
    if (command === "review" || command === "review-record") {
      const allowed = [
        "config",
        "profile",
        "scope",
        "constraints",
        "as-of",
        "format",
        ...(command === "review"
          ? ["registry"]
          : ["owner", "review-by", "output"]),
      ];
      for (const key of Object.keys(values))
        if (!allowed.includes(key))
          throw new InputError(`--${key} is not supported by ${command}`);
      return await reviewCommand(cwd, command, values);
    }
    if (
      values.registry !== undefined ||
      values.owner !== undefined ||
      values["review-by"] !== undefined
    )
      throw new InputError(
        "--registry, --owner and --review-by are review/review-record-only",
      );
    if (command === "run") {
      if (!runCommand || separator < 0)
        throw new InputError(
          "Use run as the first argument and include -- <executable> [arguments...]",
        );
      const allowed = ["config", "profile", "scope", "constraints", "handoff"];
      for (const key of Object.keys(values)) {
        if (
          key === "format" &&
          !wrapperArgs.some(
            (arg) => arg === "--format" || arg.startsWith("--format="),
          )
        )
          continue;
        if (!allowed.includes(key))
          throw new InputError(
            `--${key} is not supported by run; content/nonempty checks and the current clock are mandatory`,
          );
      }
      return await runVerified(cwd, values, rawArgs.slice(separator + 1));
    }
    if (command === "diff" || command === "setup") {
      const allowed =
        command === "diff" ? ["before", "after", "format"] : ["dry-run"];
      for (const key of Object.keys(values)) {
        if (
          key === "format" &&
          values.format === "text" &&
          !process.argv
            .slice(2)
            .some((arg) => arg === "--format" || arg.startsWith("--format="))
        )
          continue;
        if (!allowed.includes(key))
          throw new InputError(`--${key} is not supported by ${command}`);
      }
      if (command === "setup") {
        await guidedSetup(cwd, values["dry-run"] ?? false);
        return 0;
      }
      if (!values.before?.trim() || !values.after?.trim())
        throw new InputError(
          "diff requires --before <snapshot> and --after <snapshot>",
        );
      const before = parseHandoff(
        (await readJsonRecord(resolve(cwd, values.before))).input,
      );
      const after = parseHandoff(
        (await readJsonRecord(resolve(cwd, values.after))).input,
      );
      const result = diffSnapshots(before, after);
      process.stdout.write(
        format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : diffText(result, format === "markdown"),
      );
      return result.status === "unchanged" ? 0 : 1;
    }
    if (values.before !== undefined || values.after !== undefined)
      throw new InputError("--before and --after are diff-only");
    if (values.profile !== undefined) {
      identifier(values.profile, "--profile");
      if (command === "init")
        throw new InputError(
          "--profile is not supported by init; author config v2 explicitly",
        );
      if (
        [values.scope, values.constraints, values.handoff].some(
          (v) => v !== undefined,
        )
      )
        throw new InputError(
          "--profile cannot be combined with --scope, --constraints or --handoff",
        );
    }
    if (
      (values.report !== undefined || values["git-context"] !== undefined) &&
      command !== "verify"
    )
      throw new InputError("--report and --git-context are verify-only");
    if (values["git-context"] && !values.report)
      throw new InputError("--git-context requires --report");
    if (values.report && format === "text")
      throw new InputError("--report requires --format json or markdown");
    if (["doctor", "hook", "hook-config"].includes(command ?? "")) {
      const allowed =
        command === "doctor"
          ? [
              "host",
              "config",
              "scope",
              "constraints",
              "handoff",
              "format",
              "profile",
            ]
          : command === "hook"
            ? ["host", "config", "require-active", "profile"]
            : ["host", "require-active", "profile"];
      for (const key of Object.keys(values)) {
        if (
          key === "format" &&
          values.format === "text" &&
          !process.argv
            .slice(2)
            .some((arg) => arg === "--format" || arg.startsWith("--format="))
        )
          continue;
        if (!allowed.includes(key))
          throw new InputError(`--${key} is not supported by ${command}`);
      }
      if (command === "doctor") {
        if (values.scope !== undefined) identifier(values.scope, "--scope");
        for (const key of ["config", "constraints", "handoff"] as const)
          if (values[key] !== undefined && !values[key].trim())
            throw new InputError(`--${key}: expected a non-empty path`);
        if (format === "markdown")
          throw new InputError("doctor supports text or json");
        const result = await doctor(cwd, values);
        if (format === "json")
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else {
          for (const d of result.diagnostics)
            process.stdout.write(
              `${d.level.toUpperCase()} ${d.code} ${terminalText(d.message)}${d.path ? ` | ${terminalText(d.path)}` : ""}\n`,
            );
          process.stdout.write(
            `DOCTOR ${result.status.toUpperCase()}\n${result.notice}\n`,
          );
        }
        return result.status === "healthy" ? 0 : 1;
      }
      if (values.host !== "claude")
        throw new InputError(
          "hook and hook-config require --host claude; other host adapters are not shipped",
        );
      if (command === "hook-config") {
        process.stdout.write(
          `${JSON.stringify(hookConfig(values.host, values["require-active"] ?? false, values.profile), null, 2)}\n`,
        );
        return 0;
      }
      if (!values.config)
        throw new InputError("hook requires --config <absolute-path>");
      // A stuck input file (for example a FIFO) must not stall a host session.
      const watchdog = setTimeout(() => {
        process.stderr.write(
          "INVALID Hook check exceeded 5 seconds; not verified\n",
        );
        process.exit(2);
      }, 5000);
      try {
        const event = await readHookInput(process.stdin);
        const result = await lifecycleHook(
          event,
          values.config,
          values["require-active"] ?? false,
          values.profile,
        );
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return 0;
      } finally {
        clearTimeout(watchdog);
        process.stdin.destroy();
      }
    }
    if (values.host !== undefined)
      throw new InputError(
        "--host is only supported by doctor, hook and hook-config",
      );
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
    const loaded = await loadConfig(cwd, values.config);
    const config = selectProfile(loaded.config, values.profile);
    const directory = loaded.directory;
    const scope = identifier(
      values.scope ?? config.scope,
      "--scope (or config.scope)",
    );
    const asOf = values["as-of"] ?? new Date().toISOString();
    timestamp(asOf, "--as-of");
    for (const key of ["constraints", "handoff", "config"] as const)
      if (values[key] !== undefined && !values[key].trim())
        throw new InputError(`--${key}: expected a non-empty path`);
    const manifestRecord = await readJsonRecord(
      values.constraints !== undefined
        ? resolve(cwd, values.constraints)
        : resolve(directory, config.constraints ?? "constraints.json"),
    );
    const manifest = parseManifest(manifestRecord.input);
    checkProject(manifest, undefined, config.projectId);
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
        ...(config.projectId === undefined
          ? {}
          : { projectId: config.projectId }),
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
    const handoffRecord = await readJsonRecord(
      values.handoff !== undefined
        ? resolve(cwd, values.handoff)
        : resolve(directory, config.handoff ?? "handoff.json"),
    );
    const handoff = parseHandoff(handoffRecord.input);
    if (values["require-content"] && handoff.schemaVersion === 1)
      throw new InputError(
        "Content tracking requires a schemaVersion 2, 3 or 4 handoff; review current rules and capture a snapshot before resuming",
      );
    const result = verify(manifest, handoff, scope, asOf, {
      requireActive: values["require-active"] ?? false,
      ...(config.projectId === undefined
        ? {}
        : { projectId: config.projectId }),
    });
    const report = values.report
      ? verificationReport(
          result,
          {
            manifest: {
              path: manifestRecord.path,
              sha256: manifestRecord.sha256,
            },
            handoff: { path: handoffRecord.path, sha256: handoffRecord.sha256 },
            config: loaded.source ?? null,
          },
          {
            requireContent: values["require-content"] ?? false,
            requireActive: values["require-active"] ?? false,
          },
          values.profile,
          values["git-context"] ? await gitContext(cwd) : undefined,
        )
      : undefined;
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report ?? result, null, 2)}\n`);
    } else if (format === "markdown") {
      process.stdout.write(
        verificationMarkdown(
          result,
          handoff,
          values["require-active"] ?? false,
          values["require-content"] ?? false,
        ) + (report ? reportMarkdown(report) : ""),
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
        `${label}  ${count} active constraints checked | ${result.findings.length} findings | scope ${scope} | as of ${result.asOf}${result.projectId === undefined ? "" : ` | project ${result.projectId}`}${handoff.schemaVersion === 1 ? " | IDs only; content changes not checked" : " | content tracked"}${count === 0 ? " | No active constraints apply to this scope and time" : ""}\n`,
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
