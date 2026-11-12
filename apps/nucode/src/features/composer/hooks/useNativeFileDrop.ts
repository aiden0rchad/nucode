import { useEffect, useRef, useState } from "react";
import { subscribeWindowDragDrop } from "../../../services/dragDrop";
import { normalizeDragPosition } from "./useComposerImageDrop";

type UseNativeFileDropArgs = {
  disabled: boolean;
  onDropPaths: (paths: string[]) => void;
};

/** Native (Tauri) file drops over one element, for composers that do their own attachment handling. */
export function useNativeFileDrop({ disabled, onDropPaths }: UseNativeFileDropArgs) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropTargetRef = useRef<HTMLElement | null>(null);
  const handlerRef = useRef(onDropPaths);
  handlerRef.current = onDropPaths;

  useEffect(() => {
    if (disabled) {
      setIsDragOver(false);
      return undefined;
    }
    return subscribeWindowDragDrop((event) => {
      const target = dropTargetRef.current;
      if (!target || event.payload.type === "leave") {
        setIsDragOver(false);
        return;
      }
      const position = normalizeDragPosition(event.payload.position, null);
      const rect = target.getBoundingClientRect();
      const isInside =
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom;
      if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = (event.payload.paths ?? []).map((path) => path.trim()).filter(Boolean);
        if (isInside && paths.length > 0) {
          handlerRef.current(paths);
        }
        return;
      }
      setIsDragOver(isInside);
    });
  }, [disabled]);

  return { dropTargetRef, isDragOver };
}
