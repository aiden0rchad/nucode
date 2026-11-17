export type Connector = { id: string; enabled: boolean; toolAllowlist?: string[] | null; toolDenylist?: string[] | null; approval: "auto" | "ask" };

export type Verdict = { decision: "allow" | "ask" | "block"; reason?: string };

const READ_TOOLS = ["web_search", "web_fetch", "browser_snapshot", "browser_get_text", "browser_take_screenshot", "browser_console_messages", "browser_network_requests", "browser_tabs", "browser_navigate", "browser_navigate_back", "browser_wait_for"];

/** The decision plus, for a block, a message that tells the model what to do instead. */
export function connectorVerdict(servers: Connector[], tool: string, mode: string, interactive: boolean): Verdict {
  const server = servers.filter(s => tool.startsWith(`mcp__${s.id.replaceAll("-", "_")}__`)).sort((a, b) => b.id.length - a.id.length)[0];
  if (!server) return { decision: "block", reason: "This connector is not configured for nucode, so its tools are unavailable." };
  const name = tool.slice(`mcp__${server.id.replaceAll("-", "_")}__`.length);
  if (!server.enabled) return { decision: "block", reason: `${name} is unavailable: the ${server.id} connector is disabled in nucode settings. Do not retry; tell the user if it is needed.` };
  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_");
  if (server.toolDenylist?.some(t => normalize(t) === name || name.startsWith(`${normalize(t)}_`))) return { decision: "block", reason: `${name} is unavailable: the user disabled this tool in the ${server.id} connector settings. Do not retry; use another tool.` };
  if (server.toolAllowlist && !server.toolAllowlist.some(t => normalize(t) === name)) return { decision: "block", reason: `${name} is unavailable: it is not on the ${server.id} connector's allowed tool list. Do not retry; use another tool.` };
  if (server.id === "nucode-browser" && READ_TOOLS.includes(name)) return { decision: "allow" };
  if (server.id === "nucode-computer" && name === "computer_screenshot") return { decision: "allow" };
  const browserHint = server.id === "nucode-browser" ? " To read the page use browser_snapshot or browser_get_text." : "";
  if (mode === "read-only") return { decision: "block", reason: `${name} is unavailable: this thread has read-only access.${browserHint} To act, the user must switch the thread to Ask or Full access.` };
  if (server.id === "nucode-computer") return { decision: "allow" };
  // Full access means no prompts; connector allow/deny lists and disabled servers still block.
  if (mode === "full-access") return { decision: "allow" };
  if (server.approval !== "ask") return { decision: "allow" };
  return interactive ? { decision: "ask" } : { decision: "block", reason: `${name} is unavailable: it needs the user's approval, and this run (a background task or subagent) cannot ask.${browserHint} Do not retry; report what you could not do, or ask the user to run it in a thread with Full access.` };
}

export function connectorDecision(servers: Connector[], tool: string, mode: string, interactive: boolean): "allow" | "ask" | "block" {
  return connectorVerdict(servers, tool, mode, interactive).decision;
}

/** omp names connector tools mcp__<server>_<tool>; return the mcp__<server>__<tool> form the policy uses. */
export function canonicalMcpName(servers: Connector[], tool: string): string | undefined {
  if (!tool.startsWith("mcp__") || tool.slice(5).includes("__")) return tool;
  const server = [...servers].sort((a, b) => b.id.length - a.id.length).find(c => tool.startsWith(`mcp__${c.id.replace(/-/g, "_")}_`));
  if (!server) return undefined;
  const prefix = `mcp__${server.id.replace(/-/g, "_")}_`;
  return prefix.slice(0, -1) + "__" + tool.slice(prefix.length);
}
