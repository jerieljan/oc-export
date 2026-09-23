import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve(import.meta.dir, "../oc-export.ts");

test("help is command-specific and works without loading config or local sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-help-"));
  try {
    const config = path.join(root, "invalid.json");
    fs.writeFileSync(config, "invalid JSON");
    for (const args of [["--help"], ["ls", "--help"], ["--extractor", "codex", "ls", "-h"]]) {
      const result = Bun.spawnSync([process.execPath, cli, "--config", config, ...args], {
        stdin: "ignore",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      const help = result.stdout.toString();
      expect(help).toContain("npx oc-export");
      if (args.includes("ls")) {
        expect(help).toStartWith("Usage: oc-export ls");
        expect(help).toContain("--json");
        expect(help).toContain("Unix milliseconds");
        expect(help).not.toContain("--raw");
      } else {
        expect(help).toContain("interactive session picker");
        expect(help).toContain("exported JSONL retains the original session data");
        expect(help).toContain("oc-export ls --help");
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
