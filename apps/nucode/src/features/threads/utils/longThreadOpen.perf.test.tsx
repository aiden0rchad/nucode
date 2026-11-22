// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Messages } from "../../messages/components/Messages";
import { prepareThreadItems } from "@utils/threadItems";
import { buildItemsFromThread } from "@utils/threadItems.conversion";
import { buildResumeHydrationPlan } from "./threadActionHelpers";

// A synthetic long thread shaped like the payload thread/resume sends for a 3,300-row omp session:
// 800 reasoning rows and assistant messages, 763 commands, 37 screenshot results of 2-4 MB.
// `inline` carries the screenshots as base64 in the payload; otherwise as content-addressed references.
function payload(inline: boolean) {
  const words = "alpha beta gamma delta epsilon zeta theta iota kappa lambda sigma omega ";
  const text = (n: number) => words.repeat(Math.ceil(n / words.length)).slice(0, n);
  const items: Record<string, unknown>[] = [{ type: "userMessage", id: "u", content: [{ type: "text", text: "start", text_elements: [] }] }];
  let shots = 0;
  for (let step = 0; step < 800; step += 1) {
    items.push({ type: "reasoning", id: `r${step}`, summary: [], content: [text(2000)] });
    items.push({ type: "agentMessage", id: `m${step}`, text: text(3000) });
    if (step % 21 === 5 && shots < 37) {
      shots += 1;
      const data = inline ? "iVBORw0KGgo".padEnd((2 + (shots % 3)) * 1024 * 1024 * 4 / 3, "A") : `blob:sha256:${String(shots).padStart(64, "0")}`;
      items.push({ type: "mcpToolCall", id: `c${step}`, server: "computer", tool: "screenshot", arguments: {}, status: "completed", durationMs: 5,
        result: { content: [{ type: "text", text: "screenshot" }, { type: "image", mimeType: "image/png", data }], structuredContent: null }, error: null });
    } else {
      items.push({ type: "commandExecution", id: `c${step}`, command: text(300), cwd: "/tmp", status: "completed", aggregatedOutput: text(step % 50 === 0 ? 400000 : 9000), commandActions: [], exitCode: 0, durationMs: 5 });
    }
  }
  expect(shots).toBe(37);
  return JSON.stringify({ thread: { id: "long", turns: [{ id: "t", status: "completed", items }] } });
}

const clock = <T,>(stage: Record<string, number>, name: string, work: () => T): T => {
  const start = performance.now();
  const value = work();
  stage[name] = Math.round(performance.now() - start);
  return value;
};

describe("opening a long thread", () => {
  afterEach(cleanup);
  it.each([true, false])("times each frontend stage (inline images: %s)", (inline) => {
    const stage: Record<string, number> = {};
    const raw = payload(inline);
    const parsed = clock(stage, "JSON.parse", () => JSON.parse(raw) as { thread: Record<string, unknown> });
    const plan = clock(stage, "buildResumeHydrationPlan (buildItemsFromThread)", () => buildResumeHydrationPlan({
      thread: parsed.thread, workspaceId: "w", threadId: "long", replaceLocal: false, localItems: [], localStatus: undefined,
      localActiveTurnId: null, getCustomName: () => undefined,
    }));
    const items = clock(stage, "buildItemsFromThread alone", () => buildItemsFromThread(parsed.thread));
    const prepared = clock(stage, "setThreadItems (prepareThreadItems)", () => prepareThreadItems(plan.mergedItems));
    clock(stage, "first render", () => render(<Messages items={prepared} threadId="long" openTargets={[]} selectedOpenAppId="" isThinking={false} />));
    console.info(`long thread frontend, inline=${inline}: payload ${(raw.length / 1e6).toFixed(1)} MB, ${items.length} items, ${prepared.length} kept; ms ${JSON.stringify(stage)}`);
    expect(prepared.length).toBeGreaterThan(0);
  }, 120000);
});
