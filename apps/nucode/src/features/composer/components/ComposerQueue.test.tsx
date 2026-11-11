/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../../../types";
import { ComposerQueue } from "./ComposerQueue";

const queuedItem: QueuedMessage = {
  id: "queued-1",
  text: "Add link to GitHub repo too",
  createdAt: 1,
};

describe("ComposerQueue", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens inline menu on queue item action tap", () => {
    render(<ComposerQueue queuedMessages={[queuedItem]} />);

    expect(screen.queryByText("Edit")).toBeNull();
    fireEvent.click(screen.getByLabelText("Queue item menu"));
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
  });

  it("calls edit callback for selected queued item", () => {
    const onEditQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onEditQueued={onEditQueued} />);

    fireEvent.click(screen.getByLabelText("Queue item menu"));
    fireEvent.click(screen.getByText("Edit"));

    expect(onEditQueued).toHaveBeenCalledTimes(1);
    expect(onEditQueued).toHaveBeenCalledWith(queuedItem);
  });

  it("calls delete callback for selected queued item", () => {
    const onDeleteQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onDeleteQueued={onDeleteQueued} />);

    fireEvent.click(screen.getByLabelText("Queue item menu"));
    fireEvent.click(screen.getByText("Delete"));

    expect(onDeleteQueued).toHaveBeenCalledTimes(1);
    expect(onDeleteQueued).toHaveBeenCalledWith(queuedItem.id);
  });

  it("steers a normal queued row from the button and the menu", () => {
    const onSteerQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onSteerQueued={onSteerQueued} />);

    fireEvent.click(screen.getByLabelText("Steer: send this message now"));
    expect(onSteerQueued).toHaveBeenCalledWith(queuedItem.id);

    fireEvent.click(screen.getByLabelText("Queue item menu"));
    const items = within(screen.getByRole("menu")).getAllByRole("button");
    expect(items[0]?.textContent).toBe("Steer now");
    fireEvent.click(items[0]!);
    expect(onSteerQueued).toHaveBeenCalledTimes(2);
  });

  it("offers no steer control for slash rows or without the prop", () => {
    const slashItem: QueuedMessage = { ...queuedItem, id: "queued-2", text: "/compact" };
    const { unmount } = render(
      <ComposerQueue queuedMessages={[slashItem]} onSteerQueued={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Steer: send this message now")).toBeNull();
    fireEvent.click(screen.getByLabelText("Queue item menu"));
    expect(screen.queryByText("Steer now")).toBeNull();
    unmount();

    render(<ComposerQueue queuedMessages={[queuedItem]} />);
    expect(screen.queryByLabelText("Steer: send this message now")).toBeNull();
    fireEvent.click(screen.getByLabelText("Queue item menu"));
    expect(screen.queryByText("Steer now")).toBeNull();
  });
});
