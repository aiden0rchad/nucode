import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** The label of this window, or `fallback` outside a Tauri window. */
export function currentWindowLabel(fallback = "main") {
  try {
    return getCurrentWindow().label ?? fallback;
  } catch {
    return fallback;
  }
}

export function useWindowLabel(defaultLabel = "main") {
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    setLabel(currentWindowLabel(defaultLabel));
  }, [defaultLabel]);

  return label;
}
