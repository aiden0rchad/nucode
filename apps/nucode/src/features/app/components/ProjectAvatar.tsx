import type { CSSProperties } from "react";

// Projects get a stable identity color, so a project reads at a glance in the sidebar, on Home and in pickers.
const HUES = ["#5b9dff", "#3ecf8e", "#f5a524", "#f472b6", "#a78bfa", "#2dd4bf", "#fb923c", "#38bdf8"];

export function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

export function ProjectAvatar({ name, className = "" }: { name: string; className?: string }) {
  const initial = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "•";
  return <span className={`project-avatar ${className}`.trim()} style={{ "--project-hue": projectHue(name) } as CSSProperties} aria-hidden="true">{initial}</span>;
}
