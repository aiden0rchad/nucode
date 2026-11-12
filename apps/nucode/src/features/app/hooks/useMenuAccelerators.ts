import { useEffect } from "react";
import { setMenuAccelerators } from "../../../services/tauri";
import { toMenuAccelerator } from "../../../utils/shortcuts";
import { useThreadWindowEffects } from "../threadWindow";

type MenuAccelerator = {
  id: string;
  shortcut: string | null | undefined;
};

type UseMenuAcceleratorsOptions = {
  accelerators: MenuAccelerator[];
  onError?: (error: unknown) => void;
};

export function useMenuAccelerators({
  accelerators,
  onError,
}: UseMenuAcceleratorsOptions) {
  // The native menu is shared; the main window is the one that keeps its accelerators current.
  const { menuAndShortcutListeners } = useThreadWindowEffects();
  useEffect(() => {
    if (!menuAndShortcutListeners) return;
    let active = true;
    const updateMenuAccelerators = async () => {
      try {
        if (!active) {
          return;
        }
        await setMenuAccelerators(
          accelerators.map(({ id, shortcut }) => ({
            id,
            accelerator: toMenuAccelerator(shortcut),
          })),
        );
      } catch (error) {
        onError?.(error);
      }
    };
    void updateMenuAccelerators();
    return () => {
      active = false;
    };
  }, [accelerators, menuAndShortcutListeners, onError]);
}
