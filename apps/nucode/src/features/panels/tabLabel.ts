/** A page that never loaded keeps its placeholder title; name the tab by its host instead. */
export function tabLabel(tab: { title: string; url?: string }) {
  if (tab.title && tab.title !== "New tab") return tab.title;
  try { return tab.url ? new URL(tab.url).host || tab.title : tab.title; } catch { return tab.title; }
}
