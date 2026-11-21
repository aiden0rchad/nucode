// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";

const h = vi.hoisted(() => ({
  onData: null as null | ((data: string) => void),
  writes: [] as string[],
  flush: null as null | (() => void),
  output: null as null | ((p: { workspaceId: string; terminalId: string; data: string }) => void),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon() {}
    open() {}
    focus() {}
    refresh() {}
    reset() {}
    dispose() {}
    onData(cb: (data: string) => void) {
      h.onData = cb;
      return { dispose() {} };
    }
    // Like xterm, replies to queries surface through onData before the write callback fires.
    write(data: string, cb?: () => void) {
      if (!cb) return;
      h.writes.push(data);
      h.flush = () => {
        h.onData?.("\x1b[?1;2c"); // a reply xterm emits mid-replay
        cb();
      };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@settings/features", () => ({ useFeatures: () => ({ terminal: true }) }));
vi.mock("../../../services/events", () => ({
  subscribeTerminalExit: () => () => {},
  subscribeTerminalOutput: (cb: typeof h.output) => {
    h.output = cb;
    return () => {};
  },
}));
const tauri = vi.hoisted(() => ({
  openTerminalSession: vi.fn().mockResolvedValue(undefined),
  resizeTerminalSession: vi.fn().mockResolvedValue(undefined),
  writeTerminalSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../services/tauri", () => tauri);

import { useTerminalSession } from "./useTerminalSession";

const ws = { id: "w1", name: "w", path: "/w", connected: true, settings: {} } as unknown as WorkspaceInfo;

describe("useTerminalSession replay", () => {
  beforeEach(() => {
    h.onData = null;
    h.writes = [];
    h.flush = null;
    Object.values(tauri).forEach((m) => m.mockClear());
  });

  it("sends nothing to the session while replaying history with queries", async () => {
    const container = document.createElement("div");
    const { rerender } = renderHook(
      (p: { id: string | null }) => {
        const s = useTerminalSession({
          activeWorkspace: ws,
          activeTerminalId: p.id,
          isVisible: true,
          focusRequestVersion: 0,
        });
        s.containerRef.current = container; // set before effects so the terminal is created
        return s;
      },
      { initialProps: { id: null as string | null } },
    );
    await act(async () => {
      h.output?.({ workspaceId: "w1", terminalId: "t1", data: "hello\x1b[c\x1b[6n\x1b]11;?\x07 world" });
    });
    await act(async () => {
      rerender({ id: "t1" });
    });
    await act(async () => {});
    expect(h.writes).toEqual(["hello world"]);

    await act(async () => {
      h.flush?.();
    });
    expect(tauri.writeTerminalSession).not.toHaveBeenCalled();

    act(() => h.onData?.("ls\r"));
    expect(tauri.writeTerminalSession).toHaveBeenCalledWith("w1", "t1", "ls\r");
  });
});
