/** @vitest-environment jsdom */
import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStickToBottom } from "./useStickToBottom";

type Stick = ReturnType<typeof useStickToBottom<HTMLDivElement>>;
let stick: Stick;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  stick = useStickToBottom(ref);
  return <div ref={ref} data-testid="scroller" tabIndex={0} {...stick.handlers}><input aria-label="field" /></div>;
}

function setup() {
  const view = render(<Harness />);
  const node = view.getByTestId("scroller") as HTMLDivElement;
  const metrics = { height: 1000 };
  Object.defineProperty(node, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(node, "scrollHeight", { configurable: true, get: () => metrics.height });
  const scrollTo = (top: number) => { node.scrollTop = top; fireEvent.scroll(node); };
  return { ...view, node, metrics, scrollTo };
}

afterEach(cleanup);

describe("useStickToBottom", () => {
  it("starts attached and follows to the bottom", () => {
    const { node } = setup();
    expect(stick.isAttached()).toBe(true);
    expect(stick.followIfAttached()).toBe(true);
    expect(node.scrollTop).toBe(1000);
  });

  it("detaches on wheel up and stops following; scrolling back near the bottom resumes", () => {
    const { node, scrollTo } = setup();
    stick.followIfAttached();
    scrollTo(800);
    fireEvent.wheel(node, { deltaY: -40 });
    expect(stick.isAttached()).toBe(false);
    node.scrollTop = 700;
    expect(stick.followIfAttached()).toBe(false);
    expect(node.scrollTop).toBe(700);
    // Moving down but still far from the bottom stays detached.
    scrollTo(750);
    expect(stick.isAttached()).toBe(false);
    // Reaching the bottom threshold while moving down re-attaches.
    scrollTo(790);
    expect(stick.isAttached()).toBe(true);
  });

  it("does not detach on wheel down", () => {
    const { node } = setup();
    fireEvent.wheel(node, { deltaY: 40 });
    expect(stick.isAttached()).toBe(true);
  });

  it("detaches when the scrollbar is dragged up", () => {
    const { scrollTo } = setup();
    scrollTo(800);
    scrollTo(500);
    expect(stick.isAttached()).toBe(false);
  });

  it("detaches on touch drag down and on navigation keys, except in fields", () => {
    const { node, getByLabelText } = setup();
    fireEvent.touchStart(node, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(node, { touches: [{ clientY: 90 }] });
    expect(stick.isAttached()).toBe(true);
    fireEvent.touchMove(node, { touches: [{ clientY: 140 }] });
    expect(stick.isAttached()).toBe(false);

    act(() => stick.attach());
    fireEvent.keyDown(getByLabelText("field"), { key: "ArrowUp" });
    expect(stick.isAttached()).toBe(true);
    for (const key of ["PageUp", "Home", "ArrowUp"]) {
      act(() => stick.attach());
      fireEvent.keyDown(node, { key });
      expect(stick.isAttached()).toBe(false);
    }
    act(() => stick.attach());
    fireEvent.keyDown(node, { key: "ArrowDown" });
    expect(stick.isAttached()).toBe(true);
  });

  it("does not detach when content shrinks at the bottom", () => {
    const { node, metrics, scrollTo } = setup();
    scrollTo(800);
    // A collapsing group: the browser clamps scrollTop to the new maximum.
    metrics.height = 600;
    scrollTo(400);
    expect(stick.isAttached()).toBe(true);
    // Even when it ends a little above the bottom.
    metrics.height = 550;
    scrollTo(345);
    expect(stick.isAttached()).toBe(true);
    stick.followIfAttached();
    expect(node.scrollTop).toBe(550);
  });
});
