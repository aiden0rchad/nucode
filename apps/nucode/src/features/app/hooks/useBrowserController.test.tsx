// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserController } from "./useBrowserController";
import { subscribeAppServerEvents } from "@services/events";
import { interruptTurn } from "@services/tauri";
import type { AppServerEvent } from "@/types";
vi.mock("@services/events", () => ({subscribeAppServerEvents:vi.fn()}));
vi.mock("@services/tauri", () => ({interruptTurn:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@utils/platformPaths", () => ({isMacPlatform:()=>true}));
let receive: (e: AppServerEvent) => void;
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(subscribeAppServerEvents).mockImplementation(fn => {receive=fn; return vi.fn();}); });
afterEach(cleanup);
it("keeps background web calls out of browser activity and take-over", async () => {
  const hook = renderHook(useBrowserController);
  for (const server of ["nucode-browser", "nucode_browser", "Browser"]) {
    for (const tool of ["web_search", "web_fetch"]) {
      act(() => receive({workspace_id:"workspace",message:{method:"item/started",params:{threadId:"thread",turnId:"turn",item:{id:tool,type:"mcpToolCall",server,tool}}}}));
      expect(hook.result.current.agentActive).toBe(false);
      expect(hook.result.current.open).toBe(false);
    }
  }
  await act(() => hook.result.current.takeOver());
  expect(interruptTurn).not.toHaveBeenCalled();
  act(() => receive({workspace_id:"workspace",message:{method:"item/started",params:{threadId:"thread",turnId:"turn",item:{id:"browser",type:"mcpToolCall",server:"Browser",tool:"browser_navigate"}}}}));
  act(() => receive({workspace_id:"workspace",message:{method:"item/completed",params:{item:{id:"web_fetch"}}}}));
  expect(hook.result.current.agentActive).toBe(true);
});
it("persists layout and interrupts the owning turn, including a different workspace", async () => {
  const hook = renderHook(useBrowserController);
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown",{key:"b",metaKey:true,shiftKey:true})); });
  expect(hook.result.current.open).toBe(true); expect(localStorage.getItem("nucode.browser.open")).toBe("true");
  act(() => hook.result.current.setWidth(640)); expect(localStorage.getItem("nucode.browser.width")).toBe("640");
  act(() => receive({workspace_id:"other",message:{method:"item/started",params:{threadId:"thread",turnId:"turn",item:{id:"call",type:"mcpToolCall",server:"Browser"}}}}));
  expect(hook.result.current.agentActive).toBe(true);
  await act(() => hook.result.current.takeOver());
  expect(interruptTurn).toHaveBeenCalledWith("other","thread","turn");
  act(() => receive({workspace_id:"other",message:{method:"item/completed",params:{threadId:"thread",item:{id:"call"}}}}));
  expect(hook.result.current.agentActive).toBe(false);
  hook.unmount();
  const restored = renderHook(useBrowserController); expect(restored.result.current.open).toBe(true); expect(restored.result.current.width).toBe(640);
});
