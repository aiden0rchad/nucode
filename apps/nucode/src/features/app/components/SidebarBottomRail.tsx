import Bug from "lucide-react/dist/esm/icons/bug";
import Megaphone from "lucide-react/dist/esm/icons/megaphone";
import { useFeatures } from "@settings/features";
import { openFeedback } from "@/features/diagnostics/client";
import Settings from "lucide-react/dist/esm/icons/settings";
import type { ReactNode } from "react";
type SidebarBottomRailProps = {
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  children?: ReactNode;
};
export function SidebarBottomRail({ onOpenSettings, onOpenDebug, showDebugButton, children }: SidebarBottomRailProps) {
  const features = useFeatures();
  return <div className="sidebar-bottom-rail"><div className="sidebar-bottom-actions is-compact">
    <button className="ghost sidebar-labeled-button sidebar-utility-button" type="button" onClick={onOpenSettings} aria-label="Open settings"><Settings size={14} aria-hidden /><span>Settings</span></button>
    {showDebugButton && <button className="ghost sidebar-labeled-button sidebar-utility-button" type="button" onClick={onOpenDebug} aria-label="Open debug log" title="New entries in the debug log"><Bug size={14} aria-hidden /><span>Log</span></button>}
    {children}
    {/* Feedback sits with the other app-level actions, not in each thread's titlebar. */}
    {features.diagnostics && <button className="ghost sidebar-labeled-button sidebar-utility-button sidebar-feedback-button" type="button" onClick={() => openFeedback()} aria-label="Log an issue or idea" title="Feedback: log an issue or idea"><Megaphone size={14} aria-hidden /></button>}
  </div></div>;
}
