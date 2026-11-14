// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentNode, AgentPolicy, AppSettings, ConversationItem } from "@/types";
import { FeatureSettings } from "@settings/features";
import { defaultAgentPolicy, setAgentMode } from "@settings/registry";
import { ComposerPolicyProvider } from "@/features/composer/components/ComposerPolicy";
import { AgentBudgetNotice, agentBudgetShortfall, agentErrorText, recommendedPerTurn } from "./AgentBudgetNotice";

afterEach(cleanup);
const node = (id: string, error?: string, children: AgentNode[] = []): AgentNode => ({ id, agent: "enlisted", status: error ? "failed" : "completed", errorMessage: error, children });
const refused = "Error: Subagent max per turn (8) reached across the command tree; the last agent is kept for a major to verify the work";
const user = (id: string): ConversationItem => ({ id, kind: "message", role: "user", text: "Build it" });
const spawn = (id: string, agentsTree: AgentNode[]): ConversationItem => ({ id, kind: "tool", toolType: "collabToolCall", title: "Collab: spawnAgent", detail: "", status: "completed", agentsTree });
const ranOut = [user("u1"), spawn("s1", [node("colonel", undefined, [node("a"), node("b", refused), node("c", refused)])])];

it("finds the agents the latest turn could not start, and only the latest turn's", () => {
  expect(agentBudgetShortfall(ranOut)).toEqual({ limit: 8, refused: 2 });
  expect(agentBudgetShortfall([...ranOut, user("u2"), spawn("s2", [node("d")])])).toBeNull();
  expect(agentBudgetShortfall([user("u1"), spawn("s1", [node("a", "429 Too many requests")])])).toBeNull();
});

it("recommends room for what was refused, a fix and a second check, up to the most a turn can have", () => {
  expect(recommendedPerTurn(8, 1)).toBe(12);
  expect(recommendedPerTurn(8, 5)).toBe(15);
  expect(recommendedPerTurn(12, 1)).toBe(18);
  expect(recommendedPerTurn(30, 4)).toBe(32);
  expect(agentErrorText(refused)).toBe("Not started: this turn had already used its 8 agents.");
  expect(agentErrorText("Model is not allowed")).toBe("Model is not allowed");
});

function Team({ save, perTurn = 8 }: { save: (policy: AgentPolicy) => Promise<void>; perTurn?: number }) {
  const base = setAgentMode(defaultAgentPolicy, "chain-of-command");
  const [policy, setPolicy] = useState<AgentPolicy>({ ...base, subagents: { ...base.subagents, maxPerTurn: perTurn } });
  return <FeatureSettings.Provider value={{ agentPolicy: policy, features: {}, providers: [] } as unknown as AppSettings}>
    <ComposerPolicyProvider scope="This conversation · Custom team" policy={policy} onChange={async next => { await save(next); setPolicy(next); }}>
      <AgentBudgetNotice items={ranOut} />
    </ComposerPolicyProvider>
  </FeatureSettings.Provider>;
}

it("raises the limit for the team in one click and then says what to do next", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<Team save={save} />);
  expect(screen.getByText(/started all 8 agents it is allowed, and 2 more were not started/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Allow 12 per turn" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].subagents.maxPerTurn).toBe(12);
  await waitFor(() => expect(screen.getByText(/The limit is now 12 per turn\. Send a follow-up/)).toBeTruthy());
  expect(screen.queryByRole("button", { name: /per turn/ })).toBeNull();
});

it("shows nothing when the turn had enough agents, and no button without a team to change", () => {
  const { container } = render(<AgentBudgetNotice items={[user("u1"), spawn("s1", [node("a")])]} />);
  expect(container.textContent).toBe("");
  render(<AgentBudgetNotice items={ranOut} />);
  expect(screen.getByText(/12 per turn leaves room/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
