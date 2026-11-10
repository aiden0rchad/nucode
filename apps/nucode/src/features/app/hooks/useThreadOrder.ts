import { useCallback, useRef, useState } from "react";

const storageKey = "nucode.threadOrder.v1";

function loadOrder(): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, ids]) =>
      Array.isArray(ids) && ids.every(id => typeof id === "string"),
    ));
  } catch {
    return {};
  }
}

export function useThreadOrder() {
  const [initialOrder] = useState(loadOrder);
  const orderRef = useRef(initialOrder);
  const [version, setVersion] = useState(0);
  const getOrder = useCallback((workspaceId: string): string[] =>
    Object.prototype.hasOwnProperty.call(orderRef.current, workspaceId) ? orderRef.current[workspaceId] : [], []);
  const saveOrder = useCallback((workspaceId: string, ids: string[]) => {
    const loaded = new Set(ids);
    const order = [...loaded, ...getOrder(workspaceId).filter(id => !loaded.has(id))];
    orderRef.current = { ...orderRef.current, [workspaceId]: order };
    try {
      localStorage.setItem(storageKey, JSON.stringify(orderRef.current));
    } catch { /* Keep the in-memory order when storage is unavailable. */ }
    setVersion(value => value + 1);
  }, [getOrder]);
  return { getOrder, saveOrder, version };
}
