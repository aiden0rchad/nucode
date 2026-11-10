// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ConversationItem } from "@/types";
import { useComposerController } from "./useComposerController";

vi.mock("@/services/tauri", () => ({ pickImageFiles: vi.fn() }));

const options: Parameters<typeof useComposerController>[0] = {
  activeThreadId: "one", activeTurnId: null, activeWorkspaceId: "workspace", activeWorkspace: null,
  isProcessing: false, isReviewing: false, steerEnabled: false, followUpMessageBehavior: "queue",
  connectWorkspace: vi.fn(), startThreadForWorkspace: vi.fn(),
  sendUserMessage: vi.fn(), sendUserMessageToThread: vi.fn(),
  startFork: vi.fn(), startReview: vi.fn(), startResume: vi.fn(), startCompact: vi.fn(),
  startMcp: vi.fn(), startFast: vi.fn(), startStatus: vi.fn(), itemsByThread: {},
};
const failure = (id: string, text: string): ConversationItem => ({
  id, kind: "message", role: "assistant", text: "Thread is running", isError: true, retryMessage: { text },
});

it("restores rejected text per thread without overwriting another draft", () => {
  const { result, rerender } = renderHook(useComposerController, { initialProps: options });
  act(() => result.current.handleDraftChange("Keep my new draft"));
  const itemsByThread = { one: [failure("one-error", "Rejected one")], two: [failure("two-error", "Rejected two")] };
  rerender({ ...options, itemsByThread });
  expect(result.current.activeDraft).toBe("Keep my new draft");
  rerender({ ...options, itemsByThread, activeThreadId: "two" });
  expect(result.current.activeDraft).toBe("Rejected two");
  act(() => result.current.handleDraftChange(""));
  rerender({ ...options, itemsByThread: { ...itemsByThread }, activeThreadId: "two" });
  expect(result.current.activeDraft).toBe("");
  rerender({ ...options, itemsByThread: { two: [failure("two-error", "Rejected again")] }, activeThreadId: "two" });
  expect(result.current.activeDraft).toBe("Rejected again");
});
