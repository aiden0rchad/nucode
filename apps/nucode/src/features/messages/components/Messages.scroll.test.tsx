// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

afterEach(cleanup);

const assistant = (text: string): ConversationItem => ({ id: "assistant-1", kind: "message", role: "assistant", text });
const user = (id: string): ConversationItem => ({ id, kind: "message", role: "user", text: id });

function mount(items: ConversationItem[]) {
  const props = { threadId: "thread", workspaceId: "ws", isThinking: true, openTargets: [], selectedOpenAppId: "" };
  const view = render(<Messages {...props} items={items} />);
  const node = view.container.querySelector(".messages.messages-full") as HTMLDivElement;
  const metrics = { height: 1000 };
  Object.defineProperty(node, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(node, "scrollHeight", { configurable: true, get: () => metrics.height });
  const update = (next: ConversationItem[], height: number) => {
    metrics.height = height;
    view.rerender(<Messages {...props} items={next} />);
  };
  return { node, update };
}

describe("Messages auto-scroll while streaming", () => {
  it("follows new content, stops after a wheel up, and resumes at the bottom", () => {
    const { node, update } = mount([assistant("one")]);
    update([assistant("one two")], 1100);
    expect(node.scrollTop).toBe(1100);

    node.scrollTop = 900;
    fireEvent.scroll(node);
    fireEvent.wheel(node, { deltaY: -30 });
    // Still within the old "near bottom" threshold of the new content, yet the view must stay put.
    node.scrollTop = 880;
    update([assistant("one two three")], 1200);
    expect(node.scrollTop).toBe(880);
    update([assistant("one two three four")], 1300);
    expect(node.scrollTop).toBe(880);

    node.scrollTop = 1250;
    fireEvent.scroll(node);
    update([assistant("one two three four five")], 1400);
    expect(node.scrollTop).toBe(1400);
  });

  it("keeps following when content shrinks at the bottom", () => {
    const { node, update } = mount([assistant("one")]);
    update([assistant("one two")], 1100);
    node.scrollTop = 900;
    fireEvent.scroll(node);
    node.scrollTop = 700;
    update([assistant("one two")], 900);
    fireEvent.scroll(node);
    update([assistant("one two three")], 1000);
    expect(node.scrollTop).toBe(1000);
  });

  it("returns to the bottom when the user sends a message", () => {
    const { node, update } = mount([user("first"), assistant("answer")]);
    fireEvent.wheel(node, { deltaY: -30 });
    node.scrollTop = 100;
    update([user("first"), assistant("answer more")], 1200);
    expect(node.scrollTop).toBe(100);
    update([user("first"), assistant("answer more"), user("second")], 1300);
    expect(node.scrollTop).toBe(1300);
  });
});
