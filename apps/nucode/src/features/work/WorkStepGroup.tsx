import type { ReactNode } from "react";
import { ChevronDown, ListTree, LoaderCircle } from "lucide-react";
import type { ConversationItem } from "@/types";
import { describeTool } from "@/features/messages/utils/messageRenderUtils";

type Step = Extract<ConversationItem, { kind: "tool" } | { kind: "reasoning" }>;

export const isWorkStep = (item: ConversationItem): item is Step => item.kind === "tool" || item.kind === "reasoning";

/** Splits a transcript into runs: consecutive agent steps become one group, everything else stays on its own. */
export function groupWorkSteps<T extends ConversationItem>(items: T[]): T[][] {
  const blocks: T[][] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (isWorkStep(item) && last && isWorkStep(last[0])) last.push(item);
    else blocks.push([item]);
  }
  return blocks;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Read 2 files · Edited 2 files · Ran 3 commands · 4 browser actions · Thought twice" */
export function summarizeWorkSteps(steps: ConversationItem[]) {
  const tally = { read: 0, edited: 0, commands: 0, browser: 0, searched: 0, thinking: 0, other: 0 };
  for (const step of steps) {
    if (step.kind === "reasoning") { tally.thinking++; continue; }
    if (step.kind !== "tool") continue;
    const { verb, category } = describeTool(step);
    if (category === "lookup") continue;
    if (category === "browser") tally.browser++;
    else if (/^Read/i.test(verb)) tally.read++;
    else if (/^(Edited|Created|Wrote|Deleted)/i.test(verb)) tally.edited++;
    else if (/^(Clicked|Selected|Typed|Pressed|Scrolled|Hovered|Dragged|Opened|Navigated|Ran page script)/i.test(verb)) tally.browser++;
    else if (/^Ran/i.test(verb)) tally.commands++;
    else if (/^Search/i.test(verb)) tally.searched++;
    else tally.other++;
  }
  return [
    tally.read && `Read ${plural(tally.read, "file")}`,
    tally.edited && `Edited ${plural(tally.edited, "file")}`,
    tally.commands && `Ran ${plural(tally.commands, "command")}`,
    tally.browser && plural(tally.browser, "browser action"),
    tally.searched && `Searched ${plural(tally.searched, "time")}`,
    tally.other && plural(tally.other, "other step"),
    tally.thinking && (tally.thinking === 1 ? "Thought once" : tally.thinking === 2 ? "Thought twice" : `Thought ${tally.thinking} times`),
  ].filter(Boolean).join(" · ");
}

/** The collapsed line stays readable: past two kinds of step it reads "17 steps · Read 2 files · Edited 2 files +3 more"; the full tally is in the tooltip and the expanded list. */
export function shortWorkSummary(steps: ConversationItem[]) {
  const parts = summarizeWorkSteps(steps).split(" · ").filter(Boolean);
  if (parts.length <= 2) return parts.join(" · ");
  const count = steps.filter(step => step.kind !== "tool" || describeTool(step).category !== "lookup").length;
  return `${plural(count, "step")} · ${parts.slice(0, 2).join(" · ")} +${parts.length - 2} more`;
}

/** A run of agent steps as one quiet line, like the Code transcript; expanding it lists each step. */
export function WorkStepGroup({ steps, open, children }: { steps: ConversationItem[]; open?: boolean; children: ReactNode }) {
  const failed = steps.filter(step => step.kind === "tool" && describeTool(step).category !== "lookup" && /fail|error/i.test(step.status ?? "")).length;
  const running = steps.some(step => step.kind === "tool" && step.status === "inProgress");
  // One glyph for every summary row; failure shows through the red count alone.
  const Icon = running ? LoaderCircle : ListTree;
  return <details className={`work-tool work-step-group${failed ? " has-error" : ""}`} open={open}>
    <summary><Icon aria-hidden className={running ? "tool-spinner" : undefined} />{failed > 0 && <span className="work-step-failed">{failed} failed</span>}<span className="work-tool-label" title={summarizeWorkSteps(steps)}>{shortWorkSummary(steps)}</span><ChevronDown aria-hidden /></summary>
    <div className="work-step-list">{children}</div>
  </details>;
}
