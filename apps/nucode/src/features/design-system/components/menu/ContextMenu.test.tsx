// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
  cleanup();
});

function Harness({
  items,
  onClose,
}: {
  items: ContextMenuItem[];
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [row, setRow] = useState<HTMLElement | null>(null);
  return (
    <div>
      <button type="button" data-testid="row" ref={setRow}>
        row
      </button>
      {open && row && (
        <ContextMenu
          items={items}
          position={{ x: 10, y: 10 }}
          returnFocusTo={row}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function baseItems(overrides: Partial<Record<string, () => void>> = {}): ContextMenuItem[] {
  return [
    { id: "a", label: "Alpha", onSelect: overrides.a ?? vi.fn() },
    { id: "b", label: "Bravo", disabled: true, disabledReason: "Nope", onSelect: vi.fn() },
    { kind: "separator", id: "sep" },
    { id: "c", label: "Charlie", shortcut: "⌘K", onSelect: overrides.c ?? vi.fn() },
    {
      kind: "submenu",
      id: "d",
      label: "Delta",
      items: [
        { id: "d1", label: "One", checked: true, onSelect: overrides.d1 ?? vi.fn() },
        { id: "d2", label: "Two", checked: false, onSelect: vi.fn() },
      ],
    },
  ];
}

describe("ContextMenu", () => {
  it("moves focus with the arrow keys, skipping separators and disabled rows", () => {
    render(<Harness items={baseItems()} />);
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Charlie/ }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Delta/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Delta/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));
  });

  it("activates with Enter and Space, then closes and returns focus to the row", () => {
    const a = vi.fn();
    const c = vi.fn();
    const onClose = vi.fn();
    render(<Harness items={baseItems({ a, c })} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("row"));
  });

  it("activates a row on Space", () => {
    const c = vi.fn();
    render(<Harness items={baseItems({ c })} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("does not activate a disabled row and shows its reason", () => {
    const onClose = vi.fn();
    render(<Harness items={baseItems()} onClose={onClose} />);
    const disabled = screen.getByRole("menuitem", { name: "Bravo" });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("title")).toBe("Nope");
    fireEvent.click(disabled);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a shortcut hint only when one is passed", () => {
    render(<Harness items={baseItems()} />);
    expect(screen.getByText("⌘K")).toBeTruthy();
    expect(document.querySelectorAll(".ctx-shortcut")).toHaveLength(1);
  });

  it("opens a submenu with Right, closes it with Left and restores focus to the parent", () => {
    const d1 = vi.fn();
    render(<Harness items={baseItems({ d1 })} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    const parent = screen.getByRole("menuitem", { name: /Delta/ });
    expect(parent.getAttribute("aria-haspopup")).toBe("menu");
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const checked = screen.getByRole("menuitemcheckbox", { name: "One" });
    expect(checked.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Two" }).getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(checked);
    fireEvent.keyDown(checked, { key: "ArrowLeft" });
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitemcheckbox", { name: "One" })).toBeNull();
    expect(document.activeElement).toBe(parent);
    fireEvent.keyDown(parent, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("menuitemcheckbox", { name: "One" }), { key: "Enter" });
    expect(d1).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a submenu on hover after a short delay and swaps it when another row is hovered", () => {
    vi.useFakeTimers();
    render(<Harness items={baseItems()} />);
    const parent = screen.getByRole("menuitem", { name: /Delta/ });
    fireEvent.mouseEnter(parent);
    expect(screen.queryByRole("menuitemcheckbox", { name: "One" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(screen.getByRole("menuitemcheckbox", { name: "One" })).toBeTruthy();
    // Entering the submenu cancels the pending close from leaving the parent row.
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Alpha" }));
    fireEvent.mouseEnter(screen.getAllByRole("menu")[1]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("menuitemcheckbox", { name: "One" })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Alpha" }));
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(screen.queryByRole("menuitemcheckbox", { name: "One" })).toBeNull();
  });

  it("closes on Escape, including from a submenu", () => {
    const onClose = vi.fn();
    render(<Harness items={baseItems()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("row"));
  });

  it("closes on a click or right-click outside, but not inside, the menu", () => {
    const onClose = vi.fn();
    render(<Harness items={baseItems()} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.contextMenu(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const again = vi.fn();
    render(<Harness items={baseItems()} onClose={again} />);
    fireEvent.mouseDown(document.body);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("closes on window blur and on scroll elsewhere", () => {
    const onClose = vi.fn();
    render(<Harness items={baseItems()} onClose={onClose} />);
    fireEvent.scroll(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const blur = vi.fn();
    render(<Harness items={baseItems()} onClose={blur} />);
    fireEvent.blur(window);
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("submits a non-empty value from an input row with Enter", () => {
    const onSubmit = vi.fn();
    render(
      <Harness
        items={[{ kind: "input", id: "new", label: "New section", placeholder: "New section…", onSubmit }]}
      />,
    );
    const input = screen.getByPlaceholderText("New section…");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  Work  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Work");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
