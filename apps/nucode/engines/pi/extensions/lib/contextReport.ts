export type ContextRowId = "messages" | "mcpTools" | "systemTools" | "systemPrompt" | "skills" | "memory" | "buffer" | "free";
export type ContextReport = {
  window: number; used: number | null; reserve: number | null; autoCompact: boolean;
  rows: { id: ContextRowId; tokens: number | null }[];
  deferred: { id: "mcpTools" | "systemTools"; tokens: number }[];
  mcpTools: string[];
  untilCompact: number | null;
};
type Tool = { name: string; description?: string; parameters?: unknown; exposure: string; namespace?: { name: string } };
const est = (text: string) => Math.ceil(text.length / 4);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function contextReport(input: {
  systemPrompt: string; contextFiles: { content: string }[]; skills: { name: string; description?: string }[];
  tools: Tool[]; activeTools: string[]; usedTokens: number | null; window: number; reserve: number | null; autoCompact: boolean;
}): ContextReport {
  const memory = sum(input.contextFiles.map(file => est(file.content)));
  const skills = sum(input.skills.map(skill => est(`${skill.name} ${skill.description ?? ""}`)));
  const systemPrompt = Math.max(0, est(input.systemPrompt) - memory - skills);
  const active = new Set(input.activeTools);
  const mcp = (tool: Tool) => (tool.namespace?.name ?? tool.name).startsWith("mcp__") || tool.name.startsWith("mcp__");
  const cost = (tool: Tool) => est(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const declared = input.tools.filter(tool => active.has(tool.name));
  const deferred = input.tools.filter(tool => !active.has(tool.name) && (tool.exposure === "codemode" || tool.exposure === "deferred"));
  const total = (tools: Tool[], isMcp: boolean) => sum(tools.filter(tool => mcp(tool) === isMcp).map(cost));
  const mcpTools = total(declared, true), systemTools = total(declared, false);
  const fixed = systemPrompt + memory + skills + mcpTools + systemTools;
  const messages = input.usedTokens === null ? null : Math.max(0, input.usedTokens - fixed);
  const used = messages === null ? null : messages + fixed;
  const buffer = input.autoCompact ? input.reserve : 0;
  const free = used === null ? null : Math.max(0, input.window - used - (buffer ?? 0));
  return {
    window: input.window, used, reserve: input.reserve, autoCompact: input.autoCompact,
    rows: [
      { id: "messages", tokens: messages }, { id: "mcpTools", tokens: mcpTools }, { id: "systemTools", tokens: systemTools },
      { id: "systemPrompt", tokens: systemPrompt }, { id: "skills", tokens: skills }, { id: "memory", tokens: memory },
      { id: "buffer", tokens: buffer }, { id: "free", tokens: free },
    ],
    deferred: [
      { id: "mcpTools" as const, tokens: total(deferred, true) }, { id: "systemTools" as const, tokens: total(deferred, false) },
    ].filter(row => row.tokens > 0),
    mcpTools: declared.filter(mcp).map(tool => tool.name).sort(),
    untilCompact: input.autoCompact && used !== null && input.reserve !== null ? Math.max(0, input.window - input.reserve - used) : null,
  };
}
