import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Last 8 characters of a session ID, used for short labels and filenames. */
export function last8(id: string): string {
  return id.slice(-8);
}

/** Expand a leading ~/ to the user's home directory. */
export function expandHome(inputPath: string): string {
  if (inputPath.startsWith("~/") || inputPath === "~") {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

/**
 * Resolve an --output argument such as "report", "out/report", or
 * "out/report.html" into its directory and extension-less base name, so
 * callers can derive sibling output files that share one base name.
 */
export function resolveOutputBase(outputBase: string): { dir: string; base: string } {
  const resolved = path.resolve(outputBase);
  return {
    dir: path.dirname(resolved),
    base: path.basename(resolved, path.extname(resolved)),
  };
}

/**
 * Run async task thunks with bounded concurrency and return the results in
 * task order. First failure rejects the returned promise; remaining workers
 * stop picking up new tasks.
 */
export async function runWithLimit<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  if (tasks.length === 0) return results;

  let next = 0;
  let failed = false;

  const workerCount = Math.max(1, Math.min(limit, tasks.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (!failed && next < tasks.length) {
      const index = next++;
      try {
        results[index] = await tasks[index]!();
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function which(command: string): string | null {
  const envPath = process.env.PATH || "";
  const pathExt = process.env.PATHEXT || "";
  const extensions = pathExt.split(path.delimiter).filter(Boolean);
  const dirs = envPath.split(path.delimiter);

  for (const dir of dirs) {
    const full = path.join(dir, command);
    if (isExecutable(full)) {
      return full;
    }
    for (const ext of extensions) {
      const withExt = full + ext;
      if (isExecutable(withExt)) {
        return withExt;
      }
    }
  }
  return null;
}

export function spawnToFile(command: string[], outputPath: string): Promise<string> {
  if (command.length === 0) {
    return Promise.reject(new Error("spawnToFile requires a non-empty command"));
  }

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write the child process's stdout directly to a file descriptor.
    // Piping stdout into a Writable stream can truncate output when the
    // child calls process.exit(0) immediately after writing, because the
    // in-process stream buffer (default 64 KB) may not have drained into
    // the pipe. A real file descriptor is flushed by the OS on exit.
    const fd = fs.openSync(outputPath, "w");

    const proc = spawn(command[0]!, command.slice(1), {
      stdio: ["ignore", fd, "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    function cleanupFd(): void {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }

    proc.on("error", (err: Error) => {
      cleanupFd();
      reject(err);
    });

    proc.on("close", (code: number | null) => {
      cleanupFd();
      if (code !== 0) {
        reject(new Error(`${command[0]} failed (exit ${code}):\n${stderr || "no output"}`));
      } else {
        resolve(outputPath);
      }
    });
  });
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawnWithStdin(command: string[], stdin: Buffer): Promise<SpawnResult> {
  if (command.length === 0) {
    return Promise.reject(new Error("spawnWithStdin requires a non-empty command"));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command[0]!, command.slice(1), {
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(stdin);
    proc.stdin.end();

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
