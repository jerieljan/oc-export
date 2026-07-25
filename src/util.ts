import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

export function spawnToFile(
  command: string[],
  outputPath: string,
): Promise<string> {
  if (command.length === 0) {
    return Promise.reject(
      new Error("spawnToFile requires a non-empty command"),
    );
  }

  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    const proc = spawn(command[0]!, command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.pipe(out);

    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    proc.on("error", (err: Error) => {
      out.destroy();
      reject(err);
    });

    proc.on("close", (code: number | null) => {
      out.end(() => {
        if (code !== 0) {
          reject(
            new Error(
              `${command[0]} failed (exit ${code}):\n${stderr || "no output"}`,
            ),
          );
        } else {
          resolve(outputPath);
        }
      });
    });
  });
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawnWithStdin(
  command: string[],
  stdin: Buffer,
): Promise<SpawnResult> {
  if (command.length === 0) {
    return Promise.reject(
      new Error("spawnWithStdin requires a non-empty command"),
    );
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
