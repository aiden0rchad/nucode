// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TurnReview } from "@/types";
import { buildConversationItem } from "@utils/threadItems";
import { Messages } from "./Messages";
import { ReviewCard, reviewFollowUp } from "./ReviewCard";

afterEach(cleanup);
const passed = { criterion: "Tests and both builds exit 0", passed: true, note: "Ran them" };
const open = { criterion: "Only the two named files changed", passed: false, note: "No earlier snapshot to compare with" };

it("says a review passed and lists its checks", () => {
  render(<ReviewCard review={{ status: "verified", message: "QA reported 1 passing criterion", checks: [passed] }} onFollowUp={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Review passed" }).textContent).toContain("QA confirmed the one check");
  expect(screen.getByText("Tests and both builds exit 0")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("names what QA could not confirm on a finished turn and sends one follow-up for it", async () => {
  const review: TurnReview = { status: "unverified", message: "QA did not verify …", checks: [passed, open] };
  const send = vi.fn().mockResolvedValue(true);
  render(<ReviewCard review={review} onFollowUp={() => send(reviewFollowUp(review))} />);
  const card = screen.getByRole("region", { name: "Review: 1 of 2 checks confirmed" });
  expect(card.textContent).toContain("The turn finished and its result stands.");
  expect(card.textContent).toContain("No earlier snapshot to compare with");
  fireEvent.click(screen.getByRole("button", { name: "Check again with QA" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send.mock.calls[0][0]).toContain("- Only the two named files changed");
});

it("says in plain words when no review covered the last change", () => {
  render(<ReviewCard review={{ status: "unverified", message: "No QA major submitted checks backed by observed tool results.", checks: [] }} onFollowUp={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Not reviewed" }).textContent).toContain("No QA review ran after the last change in this turn.");
  expect(screen.getByRole("button", { name: "Run a QA review" })).toBeTruthy();
});

it("shows a turn's review as a card in the conversation, not as a failed turn", () => {
  const item = buildConversationItem({ type: "agentMessage", id: "turn-1:verification", text: "**Chain of Command verification: unverified**", review: { status: "unverified", message: "QA did not verify …", checks: [passed, open] } });
  expect(item).toMatchObject({ kind: "message", review: { status: "unverified" } });
  render(<Messages items={[{ id: "u", kind: "message", role: "user", text: "Build it" }, item!]} threadId="thread" workspaceId="workspace" isThinking={false} openTargets={[]} selectedOpenAppId="" onRetryMessage={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Review: 1 of 2 checks confirmed" })).toBeTruthy();
  expect(screen.queryByText(/Chain of Command verification/)).toBeNull();
  expect(screen.queryByRole("region", { name: "Review needs follow-up" })).toBeNull();
});
