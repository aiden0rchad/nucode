import { useCallback, useEffect, useState } from "react";
import { subscribeAppServerEvents } from "@services/events";
import { interruptTurn } from "@services/tauri";
import { matchesShortcut } from "@utils/shortcuts";
import { isMacPlatform } from "@utils/platformPaths";

type Turn = { workspace: string; thread: string; turn: string };
/** `thread` is the thread being viewed: only its browser calls count as "the agent is using the browser", and Take over stops only its turn. Without it every thread counts. */
export function useBrowserController(shortcut = true, thread?: string) {
  const [open, setOpen] = useState(() => localStorage.getItem("nucode.browser.open") === "true");
  const [width, setWidth] = useState(() => Math.min(900, Math.max(320, Number(localStorage.getItem("nucode.browser.width")) || 520)));
  const [calls, setCalls] = useState<Record<string, Turn>>({});
  const toggle = useCallback(() => setOpen(value => !value), []);
  useEffect(() => { localStorage.setItem("nucode.browser.open", String(open)); }, [open]);
  useEffect(() => { localStorage.setItem("nucode.browser.width", String(width)); }, [width]);
  useEffect(() => {
    if (!shortcut) return;
    const key = (e: KeyboardEvent) => { if (matchesShortcut(e, isMacPlatform() ? "cmd+shift+b" : "ctrl+shift+b")) { e.preventDefault(); e.stopPropagation(); toggle(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [toggle, shortcut]);
  useEffect(() => subscribeAppServerEvents(event => {
    const message = event.message;
    const params = (message.params ?? {}) as Record<string, unknown>;
    const item = params.item as Record<string, unknown> | undefined;
    const thread = String(params.threadId ?? "");
    if (message.method === "item/started" && item?.type === "mcpToolCall" && ["nucode-browser", "nucode_browser", "Browser"].includes(String(item.server)) && !["web_search", "web_fetch"].includes(String(item.tool))) {
      setCalls(previous => ({ ...previous, [`${event.workspace_id}:${item.id}`]: { workspace: event.workspace_id, thread, turn: String(params.turnId ?? "") } }));
    } else if (message.method === "item/completed" && item) {
      setCalls(previous => { const next = { ...previous }; delete next[`${event.workspace_id}:${item.id}`]; return next; });
    } else if (message.method === "turn/completed" || message.method === "thread/closed") {
      setCalls(previous => Object.fromEntries(Object.entries(previous).filter(([,v]) => v.workspace !== event.workspace_id || v.thread !== thread)));
    }
  }), []);
  const viewed = Object.values(calls).filter(turn => thread === undefined || turn.thread === thread);
  const takeOver = useCallback(async () => {
    const turns = new Map(Object.values(calls).filter(turn => thread === undefined || turn.thread === thread).map(turn => [`${turn.workspace}:${turn.thread}:${turn.turn}`, turn]));
    await Promise.all([...turns.values()].map(turn => interruptTurn(turn.workspace, turn.thread, turn.turn)));
  }, [calls, thread]);
  return { open, setOpen, width, setWidth, toggle, agentActive: viewed.length > 0, takeOver };
}
