// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ConversationItem } from "@/types";
import { useComposerController } from "./useComposerController";

vi.mock("@/services/tauri", () => ({ pickImageFiles: vi.fn() }));
const toasts = vi.hoisted(() => ({ pushErrorToast: vi.fn() }));
vi.mock("@/services/toasts", () => toasts);

const options: Parameters<typeof useComposerController>[0] = {
  activeThreadId: "one", activeTurnId: null, activeWorkspaceId: "workspace", activeWorkspace: null,
  isProcessing: false, isReviewing: false, steerEnabled: false, followUpMessageBehavior: "queue",
  connectWorkspace: vi.fn(), startThreadForWorkspace: vi.fn(),
  sendUserMessage: vi.fn(), sendUserMessageToThread: vi.fn(),
  startFork: vi.fn(), startReview: vi.fn(), startResume: vi.fn(), startCompact: vi.fn(),
  startMcp: vi.fn(), startFast: vi.fn(), startStatus: vi.fn(), startContextCommand: vi.fn(), itemsByThread: {},
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

it("leaves the composer empty after a turn that needs a follow-up instead of a resend", () => {
  const { result, rerender } = renderHook(useComposerController, { initialProps: options });
  const unverified: ConversationItem = { id: "one-error", kind: "message", role: "assistant", isError: true,
    text: "Turn failed: Verification incomplete: no checks were submitted", retryMessage: { text: "Build the whole feature" } };
  rerender({ ...options, itemsByThread: { one: [unverified] } });
  expect(result.current.activeDraft).toBe("");
});

it("says why a message could not be sent and puts it back in the composer", async () => {
  const sendUserMessage = vi.fn().mockRejectedValue("The engine could not start");
  const { result } = renderHook(useComposerController, { initialProps: { ...options, activeThreadId: null, sendUserMessage } });
  await act(() => result.current.handleSend("Plan the overhaul", []));
  expect(toasts.pushErrorToast).toHaveBeenCalledWith({ title: "Message not sent", message: "The engine could not start" });
  expect(result.current.prefillDraft).toMatchObject({ text: "Plan the overhaul" });
});
