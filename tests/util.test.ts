import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { expandHome, last8, resolveOutputBase, runWithLimit } from "../src/util.js";

describe("last8", () => {
  test("returns the last 8 characters", () => {
    expect(last8("ses_abcdefgh1234")).toBe("efgh1234");
  });

  test("returns the whole string when it is shorter than 8", () => {
    expect(last8("abc")).toBe("abc");
  });
});

describe("expandHome", () => {
  test("expands a ~/ prefix to the home directory", () => {
    expect(expandHome("~/foo/bar")).toBe(path.join(os.homedir(), "foo/bar"));
  });

  test("expands a bare ~", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });

  test("leaves other paths untouched", () => {
    expect(expandHome("/usr/local/share")).toBe("/usr/local/share");
    expect(expandHome("relative/path")).toBe("relative/path");
    // Only a leading ~ is special.
    expect(expandHome("weird~path")).toBe("weird~path");
  });
});

describe("resolveOutputBase", () => {
  test("strips extensions and keeps the directory", () => {
    expect(resolveOutputBase("out/report.html")).toEqual({
      dir: path.resolve("out"),
      base: "report",
    });
  });

  test("handles names without extensions", () => {
    const result = resolveOutputBase("report");
    expect(result.base).toBe("report");
    expect(result.dir).toBe(path.resolve("."));
  });
});

describe("runWithLimit", () => {
  test("returns results in task order", async () => {
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      // Later tasks resolve first; order must still be preserved.
      await new Promise((resolve) => setTimeout(resolve, (6 - i) * 5));
      return i * 10;
    });
    expect(await runWithLimit(tasks, 3)).toEqual([0, 10, 20, 30, 40, 50]);
  });

  test("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return true;
    });

    await runWithLimit(tasks, 4);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  test("rejects on the first failure and stops scheduling new tasks", async () => {
    let started = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      started++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (i === 1) throw new Error("boom");
      return i;
    });

    expect(runWithLimit(tasks, 2)).rejects.toThrow("boom");
    // Give remaining workers a moment to wind down before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toBeLessThan(10);
  });

  test("handles an empty task list", async () => {
    expect(await runWithLimit([], 4)).toEqual([]);
  });
});
