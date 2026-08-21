import os from "node:os";
import path from "node:path";
import { Redactor } from "@redactpii/node";

const CWD = process.cwd();
const HOME = os.homedir();

const redactor = new Redactor({
  rules: {
    CREDIT_CARD: true,
    EMAIL: true,
    NAME: true,
    PHONE: true,
    SSN: true,
  },
  globalReplaceWith: "[REDACTED]",
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPunctuationAfterPath(char: string): boolean {
  return ".,;:!?)]}'\"`".includes(char);
}

export function sanitizePathForDisplay(rawPath: string): string {
  return relativizePath(rawPath);
}

export function sanitizeText(text: string): string {
  if (!text) return text;
  text = sanitizePaths(text);
  text = redactor.redact(text);
  return text;
}

function sanitizePaths(text: string): string {
  // Protect http://, https://, s3:// etc. so we do not strip their path
  // segments. We intentionally leave file:// unprotected so local file paths
  // inside it are still sanitized.
  const urlRegex = /[a-z][a-z0-9+.-]*:\/\/[^\s/$.?#][^\s]*/gi;
  const urls: string[] = [];
  let protectedText = text.replace(urlRegex, (url) => {
    urls.push(url);
    return `\u0000URL_${urls.length - 1}\u0000`;
  });

  // Protect inline code spans so slash commands such as /model are not
  // mistaken for absolute paths.
  const codeSpanRegex = /`[^`]*`/g;
  const codeSpans: string[] = [];
  protectedText = protectedText.replace(codeSpanRegex, (span) => {
    codeSpans.push(span);
    return `\u0000CODE_${codeSpans.length - 1}\u0000`;
  });

  // Replace known prefixes (cwd and home) first, because they may contain
  // spaces and we want cwd to win over home when a path is under both.
  protectedText = replaceKnownPrefix(protectedText, CWD, true);
  protectedText = replaceKnownPrefix(protectedText, HOME, false);

  // Remaining absolute paths (no spaces in segments).  The negative
  // lookbehind stops us from matching "/foo" inside "./foo", "~/foo", or
  // "file:///foo".
  const absolutePathRegex =
    /([A-Za-z]:\\(?:[^\\/?*"<>|\r\n]+(?:\\[^\\/?*"<>|\r\n]+)*))|(?<![A-Za-z0-9_.~])(?!\/\/)(\/(?:[^/\s"<>|]+(?:\/[^/\s"<>|]+)*))/g;
  protectedText = protectedText.replace(
    absolutePathRegex,
    (
      match,
      winPath: string | undefined,
      unixPath: string | undefined,
      offset: number,
      string: string,
    ) => {
      const candidate = winPath ?? unixPath;
      if (!candidate || candidate.length <= 1) return match;
      const rel = relativizePath(candidate);
      if (rel === "." && isPunctuationAfterPath(string[offset + match.length] ?? "")) {
        return path.basename(CWD);
      }
      return rel;
    },
  );

  // Restore protected URLs and code spans.
  return protectedText
    .replace(/\u0000URL_(\d+)\u0000/g, (_, index: string) => urls[parseInt(index, 10)]!)
    .replace(/\u0000CODE_(\d+)\u0000/g, (_, index: string) => codeSpans[parseInt(index, 10)]!);
}

function replaceKnownPrefix(text: string, prefix: string, allowCwd: boolean): string {
  if (!prefix) return text;
  const escaped = escapeRegex(prefix);
  const re = new RegExp(`${escaped}((?:[/\\\\][^\\n]*?)?)(?=[\\s"<>(){}\\[\\],;:!?.'\`]|$)`, "g");
  return text.replace(re, (match, pathPart: string, offset: number) => {
    const tail = text.slice(offset + match.length);
    const fullPath = prefix + pathPart;
    const normalized = path.normalize(fullPath.replace(/\\/g, "/"));
    if (!allowCwd && isUnderCwd(normalized)) return match;
    const rel = relativizePath(normalized);
    if (rel === "." && tail.length > 0 && isPunctuationAfterPath(tail[0]!)) {
      return path.basename(CWD);
    }
    return rel;
  });
}

function isUnderCwd(normalized: string): boolean {
  return normalized === CWD || normalized.startsWith(CWD + path.sep);
}

function relativizePath(rawPath: string): string {
  try {
    const isWinAbs = /^[A-Za-z]:[\\/]/.test(rawPath);
    const normalized = path.normalize(rawPath.replace(/\\/g, "/"));
    if (!path.isAbsolute(normalized) && !isWinAbs) return rawPath;

    if (isWinAbs && process.platform !== "win32") {
      return "[ABSOLUTE_PATH]";
    }

    const relToCwd = path.relative(CWD, normalized);
    if (!relToCwd.startsWith("..")) {
      const rel = relToCwd.replace(/\\/g, "/");
      if (rel === "") return ".";
      return rel.startsWith(".") ? rel : `./${rel}`;
    }
    const relToHome = path.relative(HOME, normalized);
    if (!relToHome.startsWith("..")) {
      return `~/${relToHome.replace(/\\/g, "/")}`;
    }

    // If trailing punctuation made the path look like it is not under cwd or
    // home (e.g., "/Users/.../cwd."), try again without that punctuation.
    const punctuation = /[.,;:!?)\]}`'"]+$/;
    const punctMatch = punctuation.exec(rawPath);
    if (punctMatch) {
      const trimmed = rawPath.slice(0, punctMatch.index);
      const trimmedRel = relativizePath(trimmed);
      if (trimmedRel !== "[ABSOLUTE_PATH]") {
        return trimmedRel === "." ? path.basename(CWD) + punctMatch[0] : trimmedRel + punctMatch[0];
      }
    }

    return "[ABSOLUTE_PATH]";
  } catch {
    return rawPath;
  }
}
