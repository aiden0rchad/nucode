// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationItemFromThreadItem } from "@utils/threadItems";
import { Messages } from "./Messages";

const { getThreadImage } = vi.hoisted(() => ({ getThreadImage: vi.fn() }));
vi.mock("@services/tauri", async () => ({ ...(await vi.importActual<typeof import("@services/tauri")>("@services/tauri")), getThreadImage }));

const hash = "a".repeat(64);
const shot = (data: string) => buildConversationItemFromThreadItem({ type: "mcpToolCall", id: `shot-${data.slice(-4)}`, server: "computer", tool: "screenshot", arguments: {}, status: "completed",
  result: { content: [{ type: "image", mimeType: "image/png", data }], structuredContent: null }, error: null, durationMs: 1 } as never)!;
const show = (items: ReturnType<typeof shot>[]) => render(<Messages items={items} threadId="thread" workspaceId="ws" isThinking={false} openTargets={[]} selectedOpenAppId="" />);

// Stands for the scroll position: nothing is on screen until a test says so.
const watching: Array<() => void> = [];
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() { watching.push(() => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
  disconnect() {}
}

describe("saved screenshots", () => {
  beforeEach(() => { watching.length = 0; vi.stubGlobal("IntersectionObserver", FakeObserver); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("loads nothing until the screenshot comes on screen", async () => {
    getThreadImage.mockResolvedValue({ result: { data: "QUJD", mimeType: "image/png" } });
    show([shot(`blob:sha256:${"c".repeat(64)}`)]);
    expect(getThreadImage).not.toHaveBeenCalled();
    act(() => watching.forEach((enter) => enter()));
    await waitFor(() => expect(getThreadImage).toHaveBeenCalledOnce());
  });
  it("renders inline bytes as they are", () => {
    show([shot("AAAA")]);
    expect(screen.getByAltText("Image 1").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(getThreadImage).not.toHaveBeenCalled();
  });
  it("loads a referenced screenshot from its thread once it is on screen", async () => {
    getThreadImage.mockResolvedValue({ result: { data: "QUJD", mimeType: "image/png" } });
    show([shot(`blob:sha256:${hash}`)]);
    act(() => watching.forEach((enter) => enter()));
    await waitFor(() => expect(screen.getByAltText("Image 1").getAttribute("src")).toBe("data:image/png;base64,QUJD"));
    expect(getThreadImage).toHaveBeenCalledOnce();
    expect(getThreadImage).toHaveBeenCalledWith("ws", "thread", `blob:sha256:${hash}`, "image/png");
  });
  it("says so when a saved screenshot cannot be loaded", async () => {
    getThreadImage.mockRejectedValue(new Error("gone"));
    show([shot(`blob:sha256:${"b".repeat(64)}`)]);
    act(() => watching.forEach((enter) => enter()));
    await waitFor(() => expect(screen.getByText("Image preview unavailable.")).toBeTruthy());
  });
});
