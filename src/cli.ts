#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import metadata from "../package.json" with { type: "json" };
import { loadConfig, readJson } from "./config.js";
import { initialize } from "./initialize.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
  timestamp,
} from "./validation.js";
import { verify } from "./verifier.js";

const help = `Handoff Check

Usage: handoff-check verify --scope <scope> [options]
       handoff-check init --scope <scope> [--agent both] [--dry-run] [--ci]

Options:
  --constraints <path>  Manifest file (default: constraints.json)
  --handoff <path>      Handoff file (default: handoff.json)
  --scope <scope>       Selected scope, including global constraints
  --config <path>       Project config (default: cwd/.handoff-check.json)
  --as-of <UTC time>    Fixed evaluation time (default: current time)
  --format text|json   Output format (default: text)
  --agent <agent>      init: codex, claude, both (default), or none
  --dry-run            init: preview files and instruction changes without writes
  --ci                 init: also create a pinned GitHub Actions check
  --version            Show package version
  --help               Show this help

Exit codes: 0 verified, 1 rule mismatch, 2 invalid input
`;

// Keep each diagnostic on one terminal line and render control bytes visibly.
function terminalText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return `\\u${code.toString(16).padStart(4, "0")}`;
    }
    return character;
  }).join("");
}

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
      },
    });
    format = values.format;
    if (format !== "text" && format !== "json")
      throw new InputError("--format: expected text or json");
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
      !["verify", "init"].includes(positionals[0] ?? "")
    )
      throw new InputError(
        "Expected command: verify or init (use --help for usage)",
      );
    const cwd = process.cwd();
    if (positionals[0] === "init") {
      for (const key of ["constraints", "handoff", "config", "as-of"] as const)
        if (values[key] !== undefined)
          throw new InputError(`--${key} is only supported by verify`);
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
    const handoff = parseHandoff(
      await readJson(
        values.handoff !== undefined
          ? resolve(cwd, values.handoff)
          : resolve(directory, config.handoff ?? "handoff.json"),
      ),
    );
    const result = verify(manifest, handoff, scope, asOf);
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const finding of result.findings) {
        process.stdout.write(
          `${finding.code.padEnd(12)} ${finding.id}  ${terminalText(finding.message)}\n`,
        );
      }
      process.stdout.write(
        `${result.status === "verified" ? "PASS" : "FAIL"}  ${result.findings.length} findings | scope ${scope} | as of ${result.asOf}\n`,
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
