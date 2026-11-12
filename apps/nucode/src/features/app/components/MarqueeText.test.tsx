// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarqueeText } from "./MarqueeText";

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function setMetrics(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
}

function renderRow() {
  render(
    <div data-marquee-host="" data-testid="row" tabIndex={0}>
      <MarqueeText className="title">A rather long title</MarqueeText>
    </div>,
  );
  return {
    row: screen.getByTestId("row"),
    title: screen.getByText("A rather long title"),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MarqueeText", () => {
  it("slides a cut-off title after the hover delay and returns when the pointer leaves", () => {
    const { row, title } = renderRow();
    setMetrics(title, 300, 100);
    fireEvent.mouseEnter(row);
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(title.classList.contains("is-scrolling")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(title.classList.contains("is-scrolling")).toBe(true);
    // 200px of overflow at 40px per second takes five seconds.
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(title.scrollLeft).toBe(200);
    fireEvent.mouseLeave(row);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(title.classList.contains("is-scrolling")).toBe(false);
    expect(title.scrollLeft).toBe(0);
  });

  it("also starts on keyboard focus", () => {
    const { row, title } = renderRow();
    setMetrics(title, 300, 100);
    fireEvent.focusIn(row);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(title.classList.contains("is-scrolling")).toBe(true);
  });

  it("does not animate a title that fits", () => {
    const { row, title } = renderRow();
    setMetrics(title, 100, 100);
    fireEvent.mouseEnter(row);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(title.classList.contains("is-scrolling")).toBe(false);
  });

  it("does not animate under reduced motion", () => {
    mockReducedMotion(true);
    const { row, title } = renderRow();
    setMetrics(title, 300, 100);
    fireEvent.mouseEnter(row);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(title.classList.contains("is-scrolling")).toBe(false);
    expect(title.scrollLeft).toBe(0);
  });

  it("measures overflow on hover rather than at render", () => {
    const { row, title } = renderRow();
    const measure = vi.fn(() => 300);
    Object.defineProperty(title, "scrollWidth", { configurable: true, get: measure });
    Object.defineProperty(title, "clientWidth", { configurable: true, value: 100 });
    expect(measure).not.toHaveBeenCalled();
    fireEvent.mouseEnter(row);
    expect(measure).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(measure).toHaveBeenCalled();
  });
});
