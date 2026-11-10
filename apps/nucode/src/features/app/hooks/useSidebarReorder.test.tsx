// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setupPointerEvents } from "@/test/pointerEvents";
import { useSidebarReorder } from "./useSidebarReorder";

setupPointerEvents();
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function List({ onReorder = vi.fn(), onMove = vi.fn(), onSelect = vi.fn(), prefix = "", options = {}, targetCanDrag = true }) {
  const row = useSidebarReorder(onReorder, onMove, options);
  return <div data-testid={`${prefix}scroll`} style={{ overflowY: "auto", overflowX: "auto" }}>
    {["a", "b", "other"].map(id => <div key={id} data-testid={`${prefix}${id}`}
      {...row(id, id === "other" ? "other" : "list", true, id !== "b" || targetCanDrag)} onClick={() => onSelect(id)}>
      {id}<button>Action</button><a href="#test">Link</a><input aria-label={`${prefix}${id} input`} />
    </div>)}
  </div>;
}

const down = (element: Element, init = {}) => fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 10, clientY: 50, ...init });
const move = (element: Element | null, clientX = 20, clientY = 50) => {
  vi.mocked(document.elementFromPoint).mockReturnValue(element);
  fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY });
};
const up = (clientX = 20, clientY = 50) => fireEvent.pointerUp(window, { pointerId: 1, clientX, clientY });

it("keeps a drop-only row targetable without drag or keyboard move controls", () => {
  const onReorder = vi.fn();
  const onMove = vi.fn();
  render(<List onReorder={onReorder} onMove={onMove} targetCanDrag={false} />);
  const source = screen.getByTestId("a");
  const target = screen.getByTestId("b");
  expect(target.dataset.reorderId).toBe("b");
  expect(target.dataset.reorderScope).toBe(source.dataset.reorderScope);
  expect(target.hasAttribute("data-reorder-draggable")).toBe(false);
  expect(target.hasAttribute("aria-description")).toBe(false);
  down(target);
  move(source);
  up();
  fireEvent.keyDown(target, { key: "ArrowUp", altKey: true });
  expect(onReorder).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
  expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  down(source);
  move(target);
  expect(target.dataset.dropEdge).toBe("after");
  up();
  expect(onReorder).toHaveBeenCalledWith("a", "b", "after");
});

it("starts beyond 4px, then reorders and suppresses exactly one subsequent click", () => {
  const onReorder = vi.fn();
  const onSelect = vi.fn();
  render(<List onReorder={onReorder} onSelect={onSelect} />);
  const a = screen.getByTestId("a");
  const b = screen.getByTestId("b");
  expect(a.hasAttribute("draggable")).toBe(false);
  down(a);
  move(b, 14, 50);
  expect(a.hasAttribute("data-dragging")).toBe(false);
  up(14, 50);
  fireEvent.click(a);
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onReorder).not.toHaveBeenCalled();
  down(a);
  move(b);
  expect(a.dataset.dragging).toBe("true");
  expect(b.dataset.dropEdge).toBe("after");
  expect(document.body.classList.contains("sidebar-reordering")).toBe(true);
  up();
  expect(onReorder).toHaveBeenCalledWith("a", "b", "after");
  expect(a.hasAttribute("data-dragging")).toBe(false);
  expect(b.hasAttribute("data-drop-edge")).toBe(false);
  expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  fireEvent.click(document.body);
  fireEvent.click(a);
  expect(onSelect).toHaveBeenCalledTimes(2);
});

it("isolates hook instances and sections and clears stale targets over invalid space", () => {
  const onReorder = vi.fn();
  render(<><List onReorder={onReorder} /><List prefix="second-" onReorder={onReorder} /></>);
  const a = screen.getByTestId("a");
  const b = screen.getByTestId("b");
  expect(a.dataset.reorderScope).not.toBe(screen.getByTestId("second-a").dataset.reorderScope);
  for (const invalid of [screen.getByTestId("second-b"), screen.getByTestId("other"), a, null]) {
    down(a);
    move(b);
    expect(b.hasAttribute("data-drop-edge")).toBe(true);
    move(invalid);
    expect(b.hasAttribute("data-drop-edge")).toBe(false);
    expect(document.body.classList.contains("sidebar-reorder-invalid")).toBe(true);
    up();
  }
  expect(onReorder).not.toHaveBeenCalled();
});

it.each(["Escape", "pointercancel"])("cancels on %s and removes gesture listeners", reason => {
  const onReorder = vi.fn();
  const remove = vi.spyOn(window, "removeEventListener");
  render(<List onReorder={onReorder} />);
  down(screen.getByTestId("a"));
  move(screen.getByTestId("b"));
  if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
  else fireEvent.pointerCancel(window, { pointerId: 1 });
  expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  for (const type of ["pointermove", "pointerup", "pointercancel", "keydown"]) {
    expect(remove.mock.calls.some(([name]) => name === type)).toBe(true);
  }
  up();
  expect(onReorder).not.toHaveBeenCalled();
});

it("ignores secondary buttons, non-primary pointers, controls, and other pointer ids", () => {
  const onReorder = vi.fn();
  render(<List onReorder={onReorder} />);
  const a = screen.getByTestId("a");
  for (const [element, init] of [[a, { button: 2 }], [a, { isPrimary: false }],
    ...Array.from(a.querySelectorAll("button, a, input"), element => [element, {}])] as [Element, PointerEventInit][]) {
    down(element, init);
    move(screen.getByTestId("b"));
    up();
    expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  }
  down(a);
  fireEvent.pointerMove(window, { pointerId: 2, clientX: 50, clientY: 50 });
  fireEvent.pointerUp(window, { pointerId: 2 });
  expect(a.hasAttribute("data-dragging")).toBe(false);
  move(screen.getByTestId("b"));
  up();
  expect(onReorder).toHaveBeenCalledOnce();
});

it("does not swallow a fresh plain click when a canceled drag produces no click", () => {
  const onSelect = vi.fn();
  render(<List onSelect={onSelect} />);
  const a = screen.getByTestId("a");
  down(a);
  move(screen.getByTestId("b"));
  fireEvent.keyDown(window, { key: "Escape" });
  down(a);
  up(10, 50);
  fireEvent.click(a);
  expect(onSelect).toHaveBeenCalledWith("a");
});

it.each(["x", "y"] as const)("scrolls the nearest ancestor along %s at both edges and cancels the frame on unmount", axis => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  const onReorder = vi.fn();
  const { unmount } = render(<List onReorder={onReorder} options={{ axis }} />);
  const scroll = screen.getByTestId("scroll");
  Object.defineProperties(scroll, { scrollHeight: { value: 500 }, clientHeight: { value: 200 }, scrollWidth: { value: 500 }, clientWidth: { value: 200 } });
  vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 200, left: 0, right: 200 } as DOMRect);
  const offset = axis === "x" ? "scrollLeft" : "scrollTop";
  const point = (edge: number) => move(screen.getByTestId("b"), axis === "x" ? edge : 20, axis === "x" ? 20 : edge);
  down(screen.getByTestId("a"));
  point(190);
  const tick = () => act(() => { const [id, callback] = frames.entries().next().value!; frames.delete(id); callback(0); });
  tick();
  tick();
  expect(scroll[offset]).toBe(16);
  point(10);
  tick();
  expect(scroll[offset]).toBe(8);
  point(100);
  tick();
  expect(scroll[offset]).toBe(8);
  unmount();
  expect(frames.size).toBe(0);
  expect(document.body.classList.contains("sidebar-reordering")).toBe(false);
  move(null);
  up();
  expect(onReorder).not.toHaveBeenCalled();
});


it.each([[120, 80, "before"], [180, 20, "after"]] as const)("uses horizontal midpoint at %s,%s (%s)", (x, y, position) => {
  const onReorder = vi.fn();
  render(<List onReorder={onReorder} options={{ axis: "x" }} />);
  const target = screen.getByTestId("b");
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ left: 100, width: 100, top: 0, height: 100 } as DOMRect);
  down(screen.getByTestId("a"));
  move(target, x, y);
  expect(target.dataset.dropEdge).toBe(position);
  up(x, y);
  expect(onReorder).toHaveBeenCalledWith("a", "b", position);
});

it("allows the handle's button while rejecting a matching handle outside the row", () => {
  const onReorder = vi.fn();
  render(<div className="handle"><List onReorder={onReorder} options={{ handle: ".handle" }} /></div>);
  const source = screen.getByTestId("a");
  down(source);
  move(screen.getByTestId("b"));
  up();
  expect(onReorder).not.toHaveBeenCalled();
  const button = source.querySelector("button")!;
  button.classList.add("handle");
  down(button);
  move(screen.getByTestId("b"));
  up();
  expect(onReorder).toHaveBeenCalledWith("a", "b", "after");
});
