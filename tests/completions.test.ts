import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fish = Bun.which("fish");
const completion = path.resolve(import.meta.dir, "../completions/oc-export.fish");

describe.skipIf(!fish)("Fish completions", () => {
  test("suggests sessions with descriptions and forwards only source/config options", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-complete-"));
    try {
      const log = path.join(root, "args");
      fs.writeFileSync(
        path.join(root, "oc-export"),
        `#!/bin/sh
printf '%s\\n' "$@" > "$OC_TEST_LOG"
printf 'ID\\tUPDATED (UTC)\\tDIRECTORY\\tTITLE\\nfull-session-id\\t2026-01-01\\t/project space\\tA session title\\n'
`,
        { mode: 0o755 },
      );
      const complete = (line: string) => {
        const result = Bun.spawnSync(
          [fish!, "--no-config", "-c", 'source "$OC_COMPLETION"; complete -C "$OC_LINE"'],
          {
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              OC_TEST_LOG: log,
              OC_COMPLETION: completion,
              OC_LINE: line,
            },
          },
        );
        expect(result.exitCode).toBe(0);
        expect(result.stderr.toString()).toBe("");
        return result.stdout.toString();
      };
      for (const [line, args] of [
        ["oc-export --session ", "ls\n"],
        ["oc-export --extractor codex --session ", "ls\n--extractor\ncodex\n"],
        [
          "oc-export --config '/config space/settings.jsonc' --extractor=codex --output report --session=full",
          "ls\n--config\n/config space/settings.jsonc\n--extractor=codex\n",
        ],
        [
          "oc-export --extractor claude --extractor codex --session full",
          "ls\n--extractor\nclaude\n--extractor\ncodex\n",
        ],
      ]) {
        const output = complete(line!);
        expect(output).toContain("full-session-id\tA session title — /project space");
        expect(fs.readFileSync(log, "utf8")).toBe(args!);
      }
      fs.rmSync(log);
      expect(complete("oc-export ls --")).toContain("--json");
      expect(complete("oc-export ls --")).not.toContain("--session");
      complete("oc-export --extractor ");
      expect(fs.existsSync(log)).toBe(false);
      for (const script of ["echo 'No sessions found.'", "echo 'Source missing' >&2; exit 1"]) {
        fs.writeFileSync(path.join(root, "oc-export"), `#!/bin/sh\n${script}\n`);
        expect(complete("oc-export --session ")).toBe("");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
