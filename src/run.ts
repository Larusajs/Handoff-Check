import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import { resolve } from "node:path";
import {
  checkDependencies,
  evaluatePrepared,
  prepareCheck,
} from "./check-cli.js";
import { loadConfig, readJson, selectProfile } from "./config.js";
import type { VerificationResult } from "./contracts.js";
import { terminalText } from "./render.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
} from "./validation.js";
import { verify } from "./verifier.js";

export interface RunOptions {
  config?: string;
  profile?: string;
  scope?: string;
  constraints?: string;
  handoff?: string;
  registry?: string;
  sources?: string;
}

/** A local preflight around an explicitly supplied executable, never a shell string. */
export async function runVerified(
  cwd: string,
  options: RunOptions,
  argv: string[],
  dependencies = checkDependencies,
): Promise<number> {
  const executable = argv[0];
  if (!executable?.trim())
    throw new InputError("run requires -- <executable> [arguments...]");
  if (
    options.profile !== undefined &&
    [options.scope, options.constraints, options.handoff].some(
      (v) => v !== undefined,
    )
  )
    throw new InputError(
      "--profile cannot be combined with --scope, --constraints or --handoff",
    );
  for (const key of ["config", "constraints", "handoff"] as const)
    if (options[key] !== undefined && !options[key].trim())
      throw new InputError(`--${key}: expected a non-empty path`);

  let child: ChildProcess | undefined;
  const signalCode = (signal: NodeJS.Signals) =>
    128 + (constants.signals[signal] ?? 1);
  const forward = (signal: "SIGINT" | "SIGTERM") => {
    if (!child) {
      process.stderr.write("RUN CANCELLED before command launch\n");
      process.exit(signalCode(signal));
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      process.stderr.write(
        `RUN SIGNAL ${signal}: forwarding to direct child\n`,
      );
      try {
        child.kill(signal);
      } catch {
        process.stderr.write(
          `RUN SIGNAL ${signal}: direct-child forwarding failed\n`,
        );
      }
    }
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  // A stalled local read must not leave a critical-action preflight waiting forever.
  const deadline = setTimeout(() => {
    process.stderr.write(
      "RUN INVALID: preflight exceeded 5 seconds; command not started\n",
    );
    process.exit(2);
  }, 5000);
  process.stderr.write(
    "RUN CHECKING: current-clock content/nonempty preflight\n",
  );
  try {
    let result: VerificationResult;
    if (options.registry !== undefined || options.sources !== undefined) {
      const prepared = await prepareCheck(
        cwd,
        { ...options, format: "text" },
        dependencies,
      );
      // No asynchronous work between this final current-clock evaluation and spawn.
      const report = evaluatePrepared(prepared, dependencies.clock());
      for (const [name, section] of Object.entries(report.checks)) {
        process.stderr.write(
          `RUN MAINTENANCE ${name}: ${section.status.toUpperCase()}\n`,
        );
        if (section.status === "invalid")
          process.stderr.write(
            `RUN INVALID ${name}: ${terminalText(section.error).slice(0, 512)}\n`,
          );
        else if ("result" in section) {
          for (const finding of section.result.findings.slice(0, 10))
            process.stderr.write(
              `RUN FINDING ${name} ${finding.code}${finding.id ? ` ${terminalText(finding.id).slice(0, 128)}` : ""}\n`,
            );
          if (section.result.findings.length > 10)
            process.stderr.write(
              `RUN FINDING ${name}: additional findings omitted\n`,
            );
        }
      }
      process.stderr.write(
        `RUN MAINTENANCE ${report.status.toUpperCase()} | ${report.activeConstraintCount} active constraints | as of ${report.asOf}\n`,
      );
      if (report.status !== "passed") {
        process.stderr.write("RUN BLOCKED: command not started\n");
        return report.status === "invalid" ? 2 : 1;
      }
      const verification = report.checks.verification;
      if (!("result" in verification))
        throw new InputError(
          "Maintained verification did not produce a result",
        );
      result = verification.result;
    } else {
      const loaded = await loadConfig(cwd, options.config, true);
      const config = selectProfile(loaded.config, options.profile);
      const scope = identifier(
        options.scope ?? config.scope,
        "--scope (or config.scope)",
      );
      const manifest = parseManifest(
        await readJson(
          options.constraints !== undefined
            ? resolve(cwd, options.constraints)
            : resolve(
                loaded.directory,
                config.constraints ?? "constraints.json",
              ),
          true,
        ),
      );
      const handoff = parseHandoff(
        await readJson(
          options.handoff !== undefined
            ? resolve(cwd, options.handoff)
            : resolve(loaded.directory, config.handoff ?? "handoff.json"),
          true,
        ),
      );
      if (handoff.schemaVersion === 1)
        throw new InputError(
          "run requires a content-aware v2/v3/v4 handoff; review and capture a baseline explicitly",
        );
      result = verify(manifest, handoff, scope, new Date().toISOString(), {
        requireActive: true,
        ...(config.projectId === undefined
          ? {}
          : { projectId: config.projectId }),
      });
    }
    const scope = result.scope;
    clearTimeout(deadline);
    if (result.status !== "verified") {
      for (const finding of result.findings)
        process.stderr.write(
          `RUN BLOCKED ${finding.code}${finding.id ? ` ${finding.id}` : ""}\n`,
        );
      process.stderr.write(
        `RUN BLOCKED: command not started | ${result.expectedConstraints.length} active constraints | scope ${scope} | as of ${result.asOf}${result.projectId ? ` | project ${result.projectId}` : ""}${options.profile ? ` | profile ${options.profile}` : ""}\n`,
      );
      return 1;
    }
    process.stderr.write(
      `RUN VERIFIED: ${result.expectedConstraints.length} active constraints | content tracked | scope ${scope} | as of ${result.asOf}${result.projectId ? ` | project ${result.projectId}` : ""}${options.profile ? ` | profile ${options.profile}` : ""}\n`,
    );
    return await new Promise<number>((done) => {
      let launchFailed = false;
      let started = false;
      try {
        child = spawn(executable, argv.slice(1), {
          cwd,
          env: process.env,
          shell: false,
          stdio: "inherit",
        });
      } catch {
        process.stderr.write(
          "RUN LAUNCH ERROR: command could not be started\n",
        );
        done(2);
        return;
      }
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (started) {
          process.stderr.write(
            `RUN PROCESS ERROR: ${terminalText(error.code ?? "UNKNOWN")} | waiting for direct child\n`,
          );
          return;
        }
        launchFailed = true;
        process.stderr.write(
          `RUN LAUNCH ERROR: ${terminalText(error.code ?? "UNKNOWN")} | command could not be started\n`,
        );
        done(2);
      });
      child.once("spawn", () => {
        started = true;
        process.stderr.write(
          "RUN STARTED: verification passed; waiting for command\n",
        );
      });
      child.once("close", (code, signal) => {
        if (launchFailed) return;
        const exitCode = code ?? (signal ? signalCode(signal) : 2);
        process.stderr.write(
          `RUN EXIT: ${exitCode}${signal ? ` | signal ${signal}` : ""}\n`,
        );
        done(exitCode);
      });
    });
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}
