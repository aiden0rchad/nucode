import { useEffect, useState, type ReactNode } from "react";
import { FeatureSettings } from "@settings/features";
import { useSidebarDensity } from "@settings/hooks/useSidebarDensity";
import { SidebarEngine } from "@app/components/SidebarTree";
import { currentWindowLabel } from "@/features/layout/hooks/useWindowLabel";
import { subscribeAppSettingsUpdated } from "@services/events";
import { getAppSettings } from "@services/tauri";
import type { AppSettings } from "@/types";

/**
 * What the mode shell gives the main window's code view (feature flags, default engine), for a window that has no
 * mode shell: it reads the settings once and follows saves made in other windows.
 */
export function ThreadWindowRoot({ children }: { children: ReactNode }) {
  useSidebarDensity();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let active = true;
    void getAppSettings().then((value) => { if (active) setSettings(value); }).catch(() => {});
    const stop = subscribeAppSettingsUpdated(({ origin, settings: updated }) => {
      if (origin !== currentWindowLabel()) setSettings(updated);
    });
    return () => { active = false; stop(); };
  }, []);
  if (!settings) return null;
  return (
    <FeatureSettings.Provider value={settings}>
      <SidebarEngine.Provider value={settings.agentPolicy?.defaultEngine ?? "pi"}>{children}</SidebarEngine.Provider>
    </FeatureSettings.Provider>
  );
}
