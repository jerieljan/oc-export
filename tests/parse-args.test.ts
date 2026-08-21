import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli-args.js";

describe("parseArgs", () => {
  test("parses plain file arguments", () => {
    const result = parseArgs(["a.json", "b.jsonl"]);
    expect(result).toEqual({
      help: false,
      args: { files: ["a.json", "b.jsonl"] },
    });
  });

  test("parses --flag value form", () => {
    const result = parseArgs([
      "--extractor",
      "claude",
      "--session",
      "abc123",
      "--config",
      "~/cfg.jsonc",
      "--output",
      "report",
      "--raw",
      "--summarize",
    ]);
    expect(result).toEqual({
      help: false,
      args: {
        extractor: "claude",
        session: "abc123",
        config: "~/cfg.jsonc",
        output: "report",
        raw: true,
        summarize: true,
        files: [],
      },
    });
  });

  test("parses --flag=value form", () => {
    const result = parseArgs(["--extractor=pi", "--session=xyz789", "--output=out/report"]);
    expect(result).toEqual({
      help: false,
      args: {
        extractor: "pi",
        session: "xyz789",
        output: "out/report",
        files: [],
      },
    });
  });

  test("does not consume the next flag as a value", () => {
    expect(parseArgs(["--extractor", "--raw"])).toEqual({
      help: false,
      error: "--extractor requires a value",
    });
  });

  test("reports missing values as errors instead of exiting", () => {
    expect(parseArgs(["--extractor"])).toEqual({
      help: false,
      error: "--extractor requires a value",
    });
    expect(parseArgs(["--output"])).toEqual({ help: false, error: "--output requires a value" });
  });

  test("rejects inline values on boolean flags", () => {
    expect(parseArgs(["--raw=true"])).toEqual({
      help: false,
      error: "--raw does not accept a value",
    });
  });

  test("reports unknown options as errors", () => {
    expect(parseArgs(["--bogus"])).toEqual({ help: false, error: "Unknown option --bogus" });
    expect(parseArgs(["-x"])).toEqual({ help: false, error: "Unknown option -x" });
  });

  test("help short-circuits parsing", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["-h"])).toEqual({ help: true });
    expect(parseArgs(["--extractor", "claude", "-h", "file.json"])).toEqual({ help: true });
  });

  test("treats non-flag arguments as files even after flags", () => {
    const result = parseArgs(["--no-raw", "session.json"]);
    expect(result).toEqual({
      help: false,
      args: { raw: false, files: ["session.json"] },
    });
  });
});
