import { useState } from "react";
import { Users } from "lucide-react";
import type { AgentNode, ConversationItem } from "@/types";
import { useTeamPolicy } from "@/features/composer/components/ComposerPolicy";
import { agentRefusal } from "./agents";

const MOST = 32;

/** The limit the latest turn hit, how many agents it could not start and whether its last place was being kept for QA, or null when it had enough. */
export function agentBudgetShortfall(items: ConversationItem[]): { limit: number; refused: number; kept: boolean } | null {
  let start = items.length;
  while (start > 0 && !(items[start - 1].kind === "message" && (items[start - 1] as { role?: string }).role === "user")) start--;
  let limit = 0, refused = 0, kept = false;
  const visit = (nodes: AgentNode[]) => {
    for (const node of nodes) {
      const hit = agentRefusal(node.errorMessage);
      if (hit) { limit = Math.max(limit, hit.limit); refused++; kept ||= hit.reason.includes("kept"); }
      visit(node.children);
    }
  };
  for (const item of items.slice(start)) if (item.kind === "tool" && item.agentsTree) visit(item.agentsTree);
  return refused ? { limit, refused, kept } : null;
}

/** Room for what was refused plus a fix and a second check, and never less than half as much again. */
export function recommendedPerTurn(limit: number, refused: number): number {
  return Math.min(MOST, limit + Math.max(refused + 2, Math.ceil(limit / 2)));
}

export function AgentBudgetNotice({ items }: { items: ConversationItem[] }) {
  const team = useTeamPolicy();
  const [failed, setFailed] = useState(false);
  const shortfall = agentBudgetShortfall(items);
  if (!shortfall) return null;
  const { limit, refused, kept } = shortfall;
  const current = team?.policy.subagents.maxPerTurn ?? limit;
  const next = recommendedPerTurn(limit, refused);
  const raised = current > limit;
  const raise = () => {
    if (!team) return;
    setFailed(false);
    void team.save({ ...team.policy, subagents: { ...team.policy.subagents, maxPerTurn: next } }).then(saved => setFailed(!saved));
  };
  return <section className="turn-error-card" aria-label="The team ran out of agents">
    <div className="turn-error-heading"><Users size={18} aria-hidden /><strong>The team ran out of agents</strong></div>
    <p>{kept ? `This turn may start ${limit} agents and keeps the last one for the QA check, so` : `This turn started all ${limit} agents it is allowed, and`} {refused} more {refused === 1 ? "was" : "were"} not started. {raised
      ? `The limit is now ${current} per turn. Send a follow-up to finish what was left.`
      : limit >= MOST ? `${MOST} is the most a turn can have. Ask for the rest in a follow-up, or split the work.`
      : `${next} per turn leaves room for those, a fix and a second check.`}</p>
    {!raised && limit < MOST && team && !team.unavailable && <div className="turn-error-actions">
      <button type="button" className="ghost" disabled={team.busy} title={`Applies to new turns · ${team.scope}`} onClick={raise}>Allow {next} per turn</button>
      <button type="button" className="ghost" disabled={team.busy} onClick={team.configure}>Team settings</button>
    </div>}
    {failed && <p role="status">Couldn’t save the new limit. Open Team settings to change it.</p>}
  </section>;
}
