import { beforeEach, describe, expect, it, vi } from "vitest";

const webviewListen = vi.fn();
const windowListen = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: webviewListen }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: windowListen }),
}));

describe("subscribeWindowDragDrop", () => {
  beforeEach(() => {
    vi.resetModules();
    webviewListen.mockReset();
    windowListen.mockReset();
  });

  it("listens on the webview, which is where Tauri delivers drops for child webviews", async () => {
    const unlisten = vi.fn();
    webviewListen.mockResolvedValue(unlisten);
    const { subscribeWindowDragDrop } = await import("./dragDrop");
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeWindowDragDrop(first);
    const stopSecond = subscribeWindowDragDrop(second);

    expect(webviewListen).toHaveBeenCalledTimes(1);
    expect(windowListen).not.toHaveBeenCalled();

    const event = { payload: { type: "drop", position: { x: 1, y: 2 }, paths: ["/projects/demo/a.txt"] } };
    webviewListen.mock.calls[0][0](event);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);

    stopFirst();
    stopSecond();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("delivers only to exclusive listeners while one is subscribed", async () => {
    webviewListen.mockResolvedValue(() => {});
    const { subscribeWindowDragDrop } = await import("./dragDrop");
    const normal = vi.fn();
    const exclusive = vi.fn();
    subscribeWindowDragDrop(normal);
    subscribeWindowDragDrop(exclusive, { exclusive: true });
    webviewListen.mock.calls[0][0]({ payload: { type: "leave", position: { x: 0, y: 0 } } });
    expect(exclusive).toHaveBeenCalledTimes(1);
    expect(normal).not.toHaveBeenCalled();
  });
});
