export type Connector = { id: string; enabled: boolean; toolAllowlist?: string[] | null; toolDenylist?: string[] | null; approval: "auto" | "ask" };

export function connectorDecision(servers: Connector[], tool: string, mode: string, interactive: boolean): "allow" | "ask" | "block" {
  const server = servers.filter(s => tool.startsWith(`mcp__${s.id.replaceAll("-", "_")}__`)).sort((a, b) => b.id.length - a.id.length)[0];
  if (!server?.enabled) return "block";
  const name = tool.slice(`mcp__${server.id.replaceAll("-", "_")}__`.length);
  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_");
  if (server.toolDenylist?.some(t => normalize(t) === name || name.startsWith(`${normalize(t)}_`)) || (server.toolAllowlist && !server.toolAllowlist.some(t => normalize(t) === name))) return "block";
  if (server.id === "nucode-browser" && ["web_search", "web_fetch", "browser_snapshot", "browser_take_screenshot", "browser_console_messages", "browser_network_requests", "browser_tabs", "browser_navigate", "browser_navigate_back", "browser_wait_for"].includes(name)) return "allow";
  if (server.id === "nucode-computer" && name === "computer_screenshot") return "allow";
  if (mode === "read-only") return "block";
  if (server.id === "nucode-computer") return "allow";
  // Full access means no prompts; connector allow/deny lists and disabled servers still block.
  if (mode === "full-access") return "allow";
  return server.approval === "ask" ? (interactive ? "ask" : "block") : "allow";
}

/**
 * The timeout, in seconds, for an eval cell that calls nucode's browser or computer tools without asking for one.
 * OMP counts those calls against the cell's 30 s default, which a single browser call (answered within 28 s) nearly
 * fills and a computer run exceeds, so the cell was stopped while the call inside it was still running.
 */
export function nucodeToolEvalTimeout(input: { code?: unknown; timeout?: unknown }): number | undefined {
  if (input.timeout !== undefined && input.timeout !== null) return undefined;
  const code = typeof input.code === "string" ? input.code : "";
  if (code.includes("mcp__nucode_computer")) return 600;
  if (code.includes("mcp__nucode_browser")) return 180;
  return undefined;
}
