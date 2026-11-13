import { describe, expect, it, vi } from "vitest";
import { pushErrorToast, pushInfoToast, subscribeErrorToasts } from "./toasts";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/features/diagnostics/client", () => ({
  diagnosticsEnabled: () => true,
  record: (...args: unknown[]) => record(...args),
}));

describe("error toasts", () => {
  it("publishes error toasts to subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeErrorToasts(listener);

    const id = pushErrorToast({
      title: "Test error",
      message: "Something went wrong",
      durationMs: 1234,
    });

    expect(id).toMatch(/^error-toast-/);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        title: "Test error",
        message: "Something went wrong",
        durationMs: 1234,
      }),
    );

    unsubscribe();
  });

  it("marks info toasts so they render without the error tint", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeErrorToasts(listener);
    pushInfoToast({ title: "Moved to Docs", message: "The chat was moved." });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ title: "Moved to Docs", tone: "info" }));
    unsubscribe();
  });

  it("records an error toast in diagnostics, and not a confirmation", () => {
    record.mockClear();
    pushInfoToast({ title: "Moved to Docs", message: "The chat was moved." });
    expect(record).not.toHaveBeenCalled();
    pushErrorToast({ title: "Couldn't move chat", message: "Unknown target project" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ code: "ui.error_toast" }));
  });
});
