import { IconButton } from "@/features/design-system/components/IconButton";
import { useEffect } from "react";
import Play from "lucide-react/dist/esm/icons/play";
import type { LaunchScriptIconId } from "../../../types";
import { PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../hooks/useMenuController";
import { LaunchScriptIconPicker } from "./LaunchScriptIconPicker";
import { DEFAULT_LAUNCH_SCRIPT_ICON } from "../utils/launchScriptIcons";

type LaunchScriptButtonProps = {
  launchScript: string | null;
  editorOpen: boolean;
  draftScript: string;
  isSaving: boolean;
  error: string | null;
  onRun: () => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  showNew?: boolean;
  newEditorOpen?: boolean;
  newDraftScript?: string;
  newDraftIcon?: LaunchScriptIconId;
  newDraftLabel?: string;
  newError?: string | null;
  onOpenNew?: () => void;
  onCloseNew?: () => void;
  onNewDraftChange?: (value: string) => void;
  onNewDraftIconChange?: (value: LaunchScriptIconId) => void;
  onNewDraftLabelChange?: (value: string) => void;
  onCreateNew?: () => void;
};

export const OPEN_LAUNCH_SCRIPT_EVENT = "nucode:open-launch-script";

export function LaunchScriptButton({
  launchScript,
  editorOpen,
  draftScript,
  isSaving,
  error,
  onRun,
  onOpenEditor,
  onCloseEditor,
  onDraftChange,
  onSave,
  showNew = false,
  newEditorOpen = false,
  newDraftScript = "",
  newDraftIcon = DEFAULT_LAUNCH_SCRIPT_ICON,
  newDraftLabel = "",
  newError = null,
  onOpenNew,
  onCloseNew,
  onNewDraftChange,
  onNewDraftIconChange,
  onNewDraftLabelChange,
  onCreateNew,
}: LaunchScriptButtonProps) {
  // Other surfaces (the browser's load error) can ask for the launch script editor without owning its state.
  useEffect(() => {
    const open = () => onOpenEditor();
    window.addEventListener(OPEN_LAUNCH_SCRIPT_EVENT, open);
    return () => window.removeEventListener(OPEN_LAUNCH_SCRIPT_EVENT, open);
  }, [onOpenEditor]);
  const editorMenu = useMenuController({
    open: editorOpen,
    onDismiss: () => {
      onCloseEditor();
      onCloseNew?.();
    },
  });
  const { containerRef: popoverRef } = editorMenu;
  const hasLaunchScript = Boolean(launchScript?.trim());
  const firstLine = launchScript?.split(/\r?\n/, 1)[0].trim() ?? "";
  const runLabel = hasLaunchScript
    ? `Run launch script: ${firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine}`
    : "Set launch script";

  return (
    <div className="launch-script-menu" ref={popoverRef}>
      <div className="launch-script-buttons">
        <IconButton
          type="button"
          className="ghost main-header-action launch-script-run ds-tooltip-trigger"
          onClick={onRun}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenEditor();
          }}
          data-tauri-drag-region="false"
          aria-label={runLabel}
          title={runLabel}
          data-tooltip={runLabel}
          data-tooltip-placement="bottom"
        >
          <Play size={14} aria-hidden />
          <span className="launch-script-label" aria-hidden>Run</span>
        </IconButton>
      </div>
      {editorOpen && (
        <PopoverSurface className="launch-script-popover" role="dialog">
          <div className="launch-script-title">Launch script</div>
          <textarea
            className="launch-script-textarea"
            placeholder="e.g. npm run dev"
            value={draftScript}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={6}
            data-tauri-drag-region="false"
          />
          {error && <div className="launch-script-error">{error}</div>}
          <div className="launch-script-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onCloseEditor();
                onCloseNew?.();
              }}
              data-tauri-drag-region="false"
            >
              Cancel
            </button>
            {showNew && onOpenNew && (
              <button
                type="button"
                className="ghost"
                onClick={onOpenNew}
                data-tauri-drag-region="false"
              >
                New
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={isSaving}
              data-tauri-drag-region="false"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
          {showNew && newEditorOpen && onNewDraftChange && onNewDraftIconChange && onCreateNew && (
            <div className="launch-script-new">
              <div className="launch-script-title">New launch script</div>
              <LaunchScriptIconPicker
                value={newDraftIcon}
                onChange={onNewDraftIconChange}
              />
              <input
                className="launch-script-input"
                type="text"
                placeholder="Optional label"
                value={newDraftLabel}
                onChange={(event) => onNewDraftLabelChange?.(event.target.value)}
                data-tauri-drag-region="false"
              />
              <textarea
                className="launch-script-textarea"
                placeholder="e.g. npm run dev"
                value={newDraftScript}
                onChange={(event) => onNewDraftChange(event.target.value)}
                rows={5}
                data-tauri-drag-region="false"
              />
              {newError && <div className="launch-script-error">{newError}</div>}
              <div className="launch-script-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={onCloseNew}
                  data-tauri-drag-region="false"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={onCreateNew}
                  disabled={isSaving}
                  data-tauri-drag-region="false"
                >
                  {isSaving ? "Saving..." : "Create"}
                </button>
              </div>
            </div>
          )}
        </PopoverSurface>
      )}
    </div>
  );
}
