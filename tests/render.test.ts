import { describe, expect, test } from "bun:test";
import { resolveNavigationConfig } from "../src/config.js";
import { renderTurnScrubber } from "../src/render/components.js";
import type { Turn } from "../src/types.js";

function makeTurns(count: number): Turn[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    thinking: [],
    tools: [],
    content: `turn ${i}`,
    synthetic: [],
  }));
}

describe("renderTurnScrubber", () => {
  test("is hidden when navigation is disabled", () => {
    const nav = resolveNavigationConfig({ enabled: false });
    expect(renderTurnScrubber(makeTurns(5), nav)).toBe("");
  });

  test("is hidden below the minTurns threshold", () => {
    const nav = resolveNavigationConfig({ minTurns: 10 });
    expect(renderTurnScrubber(makeTurns(5), nav)).toBe("");
  });

  test("renders one link per turn and a progress bar by default", () => {
    const html = renderTurnScrubber(makeTurns(3), resolveNavigationConfig());
    expect(html).toContain("turn-scrubber");
    expect(html).toContain("turn-scrubber-progress");
    expect(html.match(/data-turn="/g)).toHaveLength(3);
  });

  test("omits the progress bar when progressBar is false", () => {
    const html = renderTurnScrubber(makeTurns(3), resolveNavigationConfig({ progressBar: false }));
    expect(html).not.toContain("turn-scrubber-progress");
  });

  test("roleColor adds per-role classes", () => {
    const html = renderTurnScrubber(makeTurns(2), resolveNavigationConfig({ roleColor: true }));
    expect(html).toContain("role-user");
    expect(html).toContain("role-assistant");
  });
});
