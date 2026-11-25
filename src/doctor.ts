import { lstat, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import metadata from "../package.json" with { type: "json" };
import { loadConfig, readJson } from "./config.js";
import {
  lifecycleArgs,
  lifecycleCommand,
  lifecycleMatcher,
} from "./lifecycle.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
} from "./validation.js";

interface Diagnostic {
  code: string;
  level: "ok" | "info" | "warning" | "error";
  message: string;
  path?: string;
}

export async function doctor(
  cwd: string,
  options: {
    config?: string;
    constraints?: string;
    handoff?: string;
    scope?: string;
    host?: string;
  },
) {
  if (
    options.host !== undefined &&
    !["claude", "codex", "cursor"].includes(options.host)
  )
    throw new InputError("doctor --host: expected claude, codex or cursor");
  const diagnostics: Diagnostic[] = [];
  const add = (
    code: string,
    level: Diagnostic["level"],
    message: string,
    path?: string,
  ) => diagnostics.push({ code, level, message, ...(path ? { path } : {}) });
  const configPath = resolve(cwd, options.config ?? ".handoff-check.json");
  const paths: { config: string; constraints?: string; handoff?: string } = {
    config: configPath,
  };
  let scope: string | undefined;
  let handoffScope: string | undefined;
  try {
    const { config, directory } = await loadConfig(cwd, options.config);
    try {
      await stat(configPath);
      add("CONFIG", "ok", "Config parsed", configPath);
    } catch {
      add(
        "CONFIG_DEFAULTS",
        "info",
        "No implicit config; default input paths apply and scope must be explicit",
        configPath,
      );
    }
    try {
      scope = identifier(
        options.scope ?? config.scope,
        "--scope (or config.scope)",
      );
      add("SCOPE", "ok", `Selected scope: ${scope}`);
    } catch (e) {
      add("SCOPE", "error", (e as Error).message);
    }
    paths.constraints =
      options.constraints === undefined
        ? resolve(directory, config.constraints ?? "constraints.json")
        : resolve(cwd, options.constraints);
    paths.handoff =
      options.handoff === undefined
        ? resolve(directory, config.handoff ?? "handoff.json")
        : resolve(cwd, options.handoff);
    try {
      const manifest = parseManifest(await readJson(paths.constraints));
      add(
        "MANIFEST",
        "ok",
        `Supported manifest v${manifest.schemaVersion}; ${manifest.constraints.length} total rules (not evaluated active count)`,
        paths.constraints,
      );
      if (!manifest.constraints.length)
        add(
          "EMPTY_MANIFEST",
          "warning",
          "Zero declared rules; author reviewed constraints before relying on policy coverage",
        );
    } catch (e) {
      add("MANIFEST", "error", (e as Error).message, paths.constraints);
    }
    try {
      const handoff = parseHandoff(await readJson(paths.handoff));
      if (handoff.schemaVersion !== 1) handoffScope = handoff.scope;
      add(
        "HANDOFF",
        handoff.schemaVersion === 1 ? "warning" : "ok",
        `Supported handoff v${handoff.schemaVersion}${handoff.schemaVersion === 1 ? "; IDs only, lifecycle adapter requires v2/v3" : "; content-aware"}`,
        paths.handoff,
      );
    } catch (e) {
      add("HANDOFF", "error", (e as Error).message, paths.handoff);
    }
    if (scope && handoffScope && scope !== handoffScope)
      add(
        "SCOPE_MISMATCH",
        "error",
        `Saved handoff scope '${handoffScope}' differs from selected '${scope}'`,
      );
  } catch (e) {
    add("CONFIG", "error", (e as Error).message, configPath);
  }

  const packagedSkill = await readFile(
    new URL("../skills/handoff-check/SKILL.md", import.meta.url),
    "utf8",
  );
  for (const host of ["codex", "claude"] as const) {
    const skillPath = resolve(
      cwd,
      host === "codex"
        ? ".agents/skills/handoff-check/SKILL.md"
        : ".claude/skills/handoff-check/SKILL.md",
    );
    for (const [kind, path] of [
      ["SKILL", skillPath],
      [
        "INSTRUCTIONS",
        resolve(cwd, host === "codex" ? "AGENTS.md" : "CLAUDE.md"),
      ],
    ] as const) {
      try {
        const text = await readFile(path, "utf8");
        if (kind === "SKILL")
          add(
            `${host}_${kind}`,
            text === packagedSkill ? "ok" : "warning",
            text === packagedSkill
              ? "Packaged skill matches"
              : "Skill differs from this package; review differences explicitly",
            path,
          );
        else {
          const start = text.indexOf("<!-- handoff-check:begin -->");
          const end = text.indexOf("<!-- handoff-check:end -->");
          if (start < 0 && end < 0)
            add(
              `${host}_${kind}`,
              options.host === host ? "warning" : "info",
              "No managed instruction block; custom prose is not assessed",
              path,
            );
          else if (
            start < 0 ||
            end < start ||
            text.split("<!-- handoff-check:begin -->").length !== 2 ||
            text.split("<!-- handoff-check:end -->").length !== 2
          )
            add(
              `${host}_${kind}`,
              "error",
              "Malformed managed instruction markers; review before init",
              path,
            );
          else {
            const pins = [
              ...text.slice(start, end).matchAll(/handoff-check@([\w.+-]+)/g),
            ].map((m) => m[1]);
            add(
              `${host}_${kind}`,
              pins.length > 0 && pins.every((pin) => pin === metadata.version)
                ? "ok"
                : "warning",
              `Managed package pins: ${pins.join(", ") || "none"}; current ${metadata.version}`,
              path,
            );
          }
        }
      } catch (e) {
        add(
          `${host}_${kind}`,
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? options.host === host
              ? "warning"
              : "info"
            : "error",
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "Integration not installed; init can create it after preview"
            : "Cannot read integration",
          path,
        );
      }
    }
  }
  const ciPath = resolve(cwd, ".github/workflows/handoff-check.yml");
  try {
    const ci = await readFile(ciPath, "utf8");
    const pins = [...ci.matchAll(/handoff-check@([\w.+-]+)/g)].map((m) => m[1]);
    add(
      "CI_PIN",
      pins.length && pins.every((pin) => pin === metadata.version)
        ? "ok"
        : "warning",
      `Textual CI pins: ${pins.join(", ") || "none"}; workflow execution is not assessed`,
      ciPath,
    );
  } catch (e) {
    add(
      "CI",
      (e as NodeJS.ErrnoException).code === "ENOENT" ? "info" : "error",
      "CI not inspected; no workflow present or readable",
      ciPath,
    );
  }
  const settingsPath = resolve(cwd, ".claude/settings.json");
  let configured = false;
  try {
    const settings = (await readJson(settingsPath)) as {
      hooks?: { SessionStart?: unknown };
      disableAllHooks?: unknown;
    };
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error("Expected settings object");
    if (
      settings.hooks !== undefined &&
      (!settings.hooks ||
        typeof settings.hooks !== "object" ||
        Array.isArray(settings.hooks))
    )
      throw new Error("Expected hooks object");
    if (
      settings.hooks?.SessionStart !== undefined &&
      !Array.isArray(settings.hooks.SessionStart)
    )
      throw new Error("Expected SessionStart array");
    if (settings.disableAllHooks === true)
      add(
        "CLAUDE_HOOK_DISABLED",
        "warning",
        "Project settings disable hooks",
        settingsPath,
      );
    const groups = settings.hooks?.SessionStart;
    if (Array.isArray(groups))
      for (const group of groups) {
        if (group && typeof group === "object" && Array.isArray(group.hooks))
          for (const hook of group.hooks) {
            if (
              hook?.command === lifecycleCommand &&
              (JSON.stringify(hook.args) === JSON.stringify(lifecycleArgs) ||
                JSON.stringify(hook.args) ===
                  JSON.stringify([...lifecycleArgs, "--require-active"]))
            ) {
              configured = true;
              add(
                "CLAUDE_HOOK",
                group.matcher === lifecycleMatcher &&
                  hook.type === "command" &&
                  hook.timeout === 10 &&
                  hook.async !== true
                  ? "ok"
                  : "warning",
                "Recognized adapter command; review matcher/type/timeout and host /hooks for actual activation",
                settingsPath,
              );
            }
          }
      }
    if (!configured)
      add(
        "CLAUDE_HOOK",
        options.host === "claude" ? "warning" : "info",
        "No recognized lifecycle adapter; use hook-config --host claude and merge explicitly",
        settingsPath,
      );
  } catch {
    try {
      await stat(settingsPath);
      add(
        "CLAUDE_SETTINGS",
        "error",
        "Settings unreadable or invalid JSON/shape; no settings were changed",
        settingsPath,
      );
    } catch {
      add(
        "CLAUDE_HOOK",
        options.host === "claude" ? "warning" : "info",
        "No project lifecycle settings inspected; use hook-config --host claude",
        settingsPath,
      );
    }
  }
  if (configured) {
    const packagePath = resolve(cwd, "node_modules/handoff-check/package.json");
    try {
      const pkg = (await readJson(packagePath)) as {
        name?: string;
        version?: string;
      };
      await stat(resolve(cwd, "node_modules/handoff-check/dist/cli.js"));
      add(
        "LOCAL_ADAPTER",
        pkg.name === "handoff-check" && pkg.version === metadata.version
          ? "ok"
          : "warning",
        `Local adapter package version ${pkg.version ?? "unknown"}; current ${metadata.version}`,
        packagePath,
      );
    } catch {
      add(
        "LOCAL_ADAPTER",
        "error",
        `Install project-local handoff-check@${metadata.version} before enabling this hook`,
        packagePath,
      );
    }
  }
  if (options.host === "codex" || options.host === "cursor")
    add(
      "HOST_ADAPTER",
      "warning",
      `${options.host} lifecycle adapter is not shipped in this version; use explicit CLI/CI and see docs/lifecycle.md`,
    );
  for (const path of [
    paths.config,
    paths.constraints,
    paths.handoff,
    settingsPath,
  ].filter((p): p is string => p !== undefined)) {
    try {
      if ((await lstat(path)).isSymbolicLink())
        add(
          "SYMLINK",
          "info",
          "Path is a symlink; input reads follow its target, as verify does",
          path,
        );
    } catch {
      /* Existing diagnostics describe unavailable paths. */
    }
  }
  return {
    schemaVersion: 1,
    packageVersion: metadata.version,
    status: diagnostics.some(
      (d) => d.level === "warning" || d.level === "error",
    )
      ? "attention"
      : "healthy",
    paths,
    ...(scope ? { scope } : {}),
    diagnostics,
    notice:
      "Read-only local diagnostics, not handoff verification or proof that host hooks/skills executed. User/global/managed host settings are not inspected.",
  };
}
