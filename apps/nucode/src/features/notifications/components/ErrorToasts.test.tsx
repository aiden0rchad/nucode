// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorToasts } from "./ErrorToasts";

vi.mock("@/features/diagnostics/client", async (original) => ({
  ...(await original<typeof import("@/features/diagnostics/client")>()),
  diagnosticsEnabled: () => true,
}));

afterEach(cleanup);

describe("ErrorToasts", () => {
  it("renders assertive live region and dismisses items", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorToasts
        toasts={[
          { id: "toast-1", title: "Error title", message: "Something failed" },
        ]}
        onDismiss={onDismiss}
      />,
    );

    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("shows a confirmation as a status without the report button", () => {
    render(
      <ErrorToasts
        toasts={[
          { id: "e", title: "Failed", message: "Something failed" },
          { id: "i", title: "Moved to Docs", message: "The chat was moved.", tone: "info" },
        ]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Moved to Docs");
    expect(screen.getAllByRole("button", { name: "Report this" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
