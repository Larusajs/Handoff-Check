import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type SourceObservation, sourceLimit, sourcePath } from "./sources.js";
import { InputError } from "./validation.js";

export async function sourceRoot(directory: string): Promise<string> {
  try {
    const root = await realpath(directory);
    if (!(await stat(root)).isDirectory()) throw new Error("not directory");
    return root;
  } catch {
    throw new InputError("Cannot resolve source project directory");
  }
}
function inside(root: string, path: string) {
  const value = relative(root, path);
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}

/** Called only for explicitly bound paths. No source contents are retained or rendered. */
export async function readSourceFile(
  root: string,
  path: string,
): Promise<SourceObservation> {
  try {
    sourcePath(path);
  } catch {
    return { status: "SOURCE_UNSAFE" };
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const observation = await (async (): Promise<SourceObservation> => {
    try {
      let current = root;
      const parts = path.split("/");
      let before: Awaited<ReturnType<typeof lstat>> | undefined;
      for (const [index, part] of parts.entries()) {
        current = resolve(current, part);
        if (!inside(root, current)) return { status: "SOURCE_UNSAFE" };
        const info = await lstat(current);
        if (
          info.isSymbolicLink() ||
          (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())
        )
          return { status: "SOURCE_UNSAFE" };
        before = info;
      }
      const resolved = await realpath(current);
      if (!inside(root, resolved)) return { status: "SOURCE_UNSAFE" };
      handle = await open(
        current,
        constants.O_RDONLY |
          (constants.O_NONBLOCK ?? 0) |
          (constants.O_NOFOLLOW ?? 0),
      );
      const info = await handle.stat();
      if (
        !info.isFile() ||
        !before ||
        info.dev !== before.dev ||
        info.ino !== before.ino
      )
        return { status: "SOURCE_UNSAFE" };
      if (info.size > sourceLimit) return { status: "SOURCE_TOO_LARGE" };
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(64 * 1024);
      let bytes = 0;
      while (true) {
        const read = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, sourceLimit - bytes + 1),
          bytes,
        );
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
        if (bytes > sourceLimit) return { status: "SOURCE_TOO_LARGE" };
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      return {
        status: "READ",
        fileHash: `sha256:${hash.digest("hex")}`,
        bytes,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        status:
          code === "ENOENT"
            ? "SOURCE_MISSING"
            : code === "ELOOP" || code === "ENOTDIR"
              ? "SOURCE_UNSAFE"
              : "SOURCE_UNREADABLE",
      };
    }
  })();
  if (handle) {
    try {
      await handle.close();
    } catch {
      return { status: "SOURCE_UNREADABLE" };
    }
  }
  return observation;
}

export async function readSourceTargets(
  directory: string,
  targets: { path: string }[],
): Promise<Map<string, SourceObservation>> {
  const result = new Map<string, SourceObservation>();
  if (!targets.length) return result;
  const root = await sourceRoot(directory);
  for (const target of targets)
    if (!result.has(target.path))
      result.set(target.path, await readSourceFile(root, target.path));
  return result;
}
