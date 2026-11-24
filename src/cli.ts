#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
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

Options:
  --constraints <path>  Manifest file (default: constraints.json)
  --handoff <path>      Handoff file (default: handoff.json)
  --scope <scope>       Selected scope, including global constraints
  --as-of <UTC time>    Fixed evaluation time (default: current time)
  --format text|json   Output format (default: text)
  --help               Show this help

Exit codes: 0 verified, 1 rule mismatch, 2 invalid input
`;

async function readJson(path: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new InputError(`Cannot read input file '${path}'`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new InputError(`Invalid JSON in '${path}'`);
  }
}

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
        constraints: { type: "string", default: "constraints.json" },
        handoff: { type: "string", default: "handoff.json" },
        scope: { type: "string" },
        "as-of": { type: "string" },
        format: { type: "string", default: "text" },
        help: { type: "boolean" },
      },
    });
    format = values.format;
    if (format !== "text" && format !== "json")
      throw new InputError("--format: expected text or json");
    if (values.help) {
      process.stdout.write(help);
      return 0;
    }
    if (positionals.length !== 1 || positionals[0] !== "verify")
      throw new InputError("Expected command: verify (use --help for usage)");
    const scope = identifier(values.scope, "--scope");
    const asOf = values["as-of"] ?? new Date().toISOString();
    timestamp(asOf, "--as-of");
    const manifest = parseManifest(await readJson(values.constraints));
    const handoff = parseHandoff(await readJson(values.handoff));
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
