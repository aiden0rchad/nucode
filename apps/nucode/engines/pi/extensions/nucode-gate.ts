import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide, inside, normalizeRule, protectedPath, safeReadOnlyCommand, type Access } from "./lib/policy.ts";
import { connectorDecision, type Connector } from "./lib/connectors.ts";
import { registerStreamRecovery } from "./lib/streamRecovery.ts";
import { ownedCommand, userHome } from "./lib/commandGuard.ts";
import { editTargets, judgedPath, loadInspect, userPath } from "./lib/toolPaths.ts";
import { contextReport } from "./lib/contextReport.ts";
import { applyResponseStyle, parseResponseStyle } from "./lib/responseStyle.ts";
import { dropArchivedReasoning, dropForeignReasoning, withoutReasoning } from "./lib/foreignReasoning.ts";

export default function (pi: ExtensionAPI) {
  registerStreamRecovery(pi);
  let captured: { systemPrompt: string; contextFiles: { content: string }[]; skills: { name: string; description?: string }[] } | undefined;
  pi.on("before_agent_start", async event => {
    const original: string | string[] = event.systemPrompt;
    let prompt = original;
    try { prompt = applyResponseStyle(original, parseResponseStyle(process.env.NUCODE_RESPONSE_STYLE)); } catch { prompt = original; }
    captured = { systemPrompt: Array.isArray(prompt) ? prompt.join("\n\n") : prompt, contextFiles: event.systemPromptOptions?.contextFiles ?? [], skills: event.systemPromptOptions?.skills ?? [] };
    if (prompt !== original) return { systemPrompt: prompt as any };
  });
  // Before every model call: keep reasoning the provider would reject out of the history (see lib/foreignReasoning.ts).
  pi.on("context", async (event: any, ctx: any) => {
    try {
      let messages = event.messages, changed = false;
      for (const drop of [(m: any[]) => dropForeignReasoning(m, ctx.model), dropArchivedReasoning]) {
        const next = drop(messages);
        if (next) { messages = next; changed = true; }
      }
      if (changed) return { messages };
    } catch {}
  });
  // Before older turns are archived: keep reasoning out of the archive, which is sent with every later request.
  pi.on("session_before_compact", async (event: any) => {
    try {
      const turns = event.preparation;
      turns.messagesToSummarize = withoutReasoning(turns.messagesToSummarize);
      turns.turnPrefixMessages = withoutReasoning(turns.turnPrefixMessages);
    } catch {}
  });
  const reportContext = async (_event: unknown, ctx: any) => {
    try {
      const usage = ctx.getContextUsage();
      if (!captured || !usage?.contextWindow) return;
      let reserve: number | null, autoCompact: boolean;
      if (typeof pi.getSettings === "function") {
        const compaction = pi.getSettings().compaction;
        reserve = compaction?.modelOverrides?.[`${ctx.model.provider}/${ctx.model.id}`]?.reserveTokens ?? compaction?.reserveTokens ?? 16384;
        autoCompact = compaction?.enabled !== false;
      } else {
        // omp has no settings API; nucode passes its compaction choice in the environment.
        const setting = JSON.parse(process.env.NUCODE_AUTOCOMPACT || "{}") as { enabled?: boolean; percent?: number | null };
        autoCompact = setting.enabled !== false;
        reserve = typeof setting.percent === "number" ? usage.contextWindow - Math.floor(usage.contextWindow * setting.percent / 100) : null;
      }
      const report = contextReport({ ...captured, tools: pi.getAllTools(), activeTools: pi.getActiveTools(), usedTokens: usage.tokens, window: usage.contextWindow, reserve, autoCompact });
      ctx.ui.setStatus("nucode-context", JSON.stringify(report));
    } catch {}
  };
  pi.on("turn_end", reportContext);
  pi.on("agent_end", reportContext);
  pi.on("session_compact", reportContext);
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.NUCODE_OMP === "1") {
      const features = JSON.parse(process.env.NUCODE_FEATURES || "{}");
      await pi.setActiveTools(pi.getActiveTools().filter(name => ["read", "bash", "edit", "write", "grep", "glob", "lsp", "debug", "eval"].includes(name) || (["subagent", "report_verification"].includes(name) && features.subagents !== false) || (name.startsWith("mcp__") && features.connectors !== false)));
    }
    ctx.ui.setStatus("nucode-gate", "ready");
  });
  pi.on("tool_call", async (event, ctx) => {
    if (process.env.NUCODE_OMP === "1") {
      if (["task", "browser", "computer", "login"].includes(event.toolName)) return { block: true, reason: "Use nucode-managed tools and subagents" };
      if (event.toolName.startsWith("mcp__") && !event.toolName.slice(5).includes("__")) {
        const connectors = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "nucode/connectors.json"), "utf8")) as Connector[];
        const connector = connectors.sort((a, b) => b.id.length - a.id.length).find(c => event.toolName.startsWith(`mcp__${c.id.replace(/-/g, "_")}_`));
        if (!connector) return { block: true, reason: "Unknown connector" };
        const prefix = `mcp__${connector.id.replace(/-/g, "_")}_`;
        event = { ...event, toolName: prefix.slice(0, -1) + "__" + event.toolName.slice(prefix.length) };
      }
    }
    if (process.env.NUCODE_CHAT === "1" && !(process.env.NUCODE_CHAT_WEB === "1" && ["mcp__nucode_browser__browser_navigate", "mcp__nucode_browser__browser_snapshot", "mcp__nucode_browser__browser_take_screenshot", "mcp__nucode_browser__web_search", "mcp__nucode_browser__web_fetch"].includes(event.toolName))) return { block: true, reason: "Tools are disabled in Chat mode" };
    if (process.env.NUCODE_OMP === "1" && !["read", "grep", "find", "glob", "bash", "write", "edit", "subagent", "report_verification"].includes(event.toolName) && !event.toolName.startsWith("mcp__")) {
      const home = process.env.PI_CODING_AGENT_DIR!, session = process.env.NUCODE_SESSION_KEY!;
      const access = JSON.parse(readFileSync(join(home, "nucode/threads", `${session}.json`), "utf8")) as Access;
      const input = (event.input ?? {}) as Record<string, unknown>;
      // OMP expands @/~ prefixes and file URLs; only auto-allow plain local paths.
      if (event.toolName === "lsp" && access.accessMode === "full-access" && !process.env.NUCODE_WORK && !process.env.NUCODE_SUBAGENT_DEPTH
        && ["definition", "type_definition", "implementation", "references", "hover", "symbols"].includes(String(input.action))
        && typeof input.file === "string" && /^[\w ./-]+$/.test(input.file) && input.file.trim()
        && inside(resolve(ctx.cwd, input.file), ctx.cwd) && !protectedPath(resolve(ctx.cwd, input.file), home)) return;
      if (access.accessMode === "read-only" || process.env.NUCODE_SUBAGENT_DEPTH || !ctx.hasUI) return { block: true, reason: "Native tool requires interactive approval" };
      // With full access the shell already runs unasked, so one answer may cover eval for the rest of the conversation.
      const file = join(home, "nucode/threads", `${session}.json`);
      const forSession = (a: Access) => event.toolName === "eval" && a.accessMode === "full-access";
      const allowed = (a: Access) => forSession(a) && a.sessionAllow.some(rule => rule.tool === "eval" && !rule.command && !rule.path);
      if (allowed(access)) return;
      const title = "nucode:approval:" + JSON.stringify({ toolCallId: event.toolCallId, tool: event.toolName, command: `${event.toolName}\n${JSON.stringify(input, null, 2)}`, cwd: ctx.cwd });
      const answer = await ctx.ui.select(title, forSession(access) ? ["Allow", "Allow for session", "Block"] : ["Allow", "Block"]);
      if (answer === "Allow for session") {
        // The access mode may have changed while the dialog was open.
        const now = JSON.parse(readFileSync(file, "utf8")) as Access;
        if (!forSession(now)) return { block: true, reason: "Thread access changed while awaiting approval" };
        if (!allowed(now)) {
          now.sessionAllow.push({ tool: "eval" });
          const temp = `${file}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify(now));
          renameSync(temp, file);
        }
        return;
      }
      if (answer !== "Allow") return { block: true, reason: "Native tool denied" };
      return;
    }
    // OMP dispatches this write through the inner MCP tool's tool_call hook.
    // Apply connector policy there once, rather than prompting for a filesystem write first.
    if (process.env.NUCODE_OMP === "1" && event.toolName === "write" && typeof event.input?.path === "string" && event.input.path.startsWith("xd://mcp__")) return;
    const input = event.input as Record<string, unknown>;
    if (["read", "write", "edit", "grep", "find", "glob", "ls"].includes(event.toolName) && typeof input.path === "string") input.path = userPath(input.path);
    const preview = event.toolName === "preview_server";
    if (preview) {
      if (process.env.NUCODE_WORK !== "1" || process.env.NUCODE_SUBAGENT_DEPTH || !ctx.hasUI) return { block: true, reason: "Preview servers belong to the parent Work task" };
      if (input.action !== "start") return;
      if (typeof input.command !== "string" || !input.command.trim()) return { block: true, reason: "A preview command is required" };
    }
    if (!preview && !["bash", "write", "edit", ...(process.env.NUCODE_WORK === "1" ? ["read", "ls", "find", "grep"] : [])].includes(event.toolName) && !event.toolName.startsWith("mcp__")) return;
    const home = process.env.PI_CODING_AGENT_DIR!;
    const session = process.env.NUCODE_SESSION_KEY;
    if (!home || !session || !/^[\w-]+$/.test(session)) return { block: true, reason: "Missing nucode thread access policy" };
    const file = join(home, "nucode", "threads", `${session}.json`);
    const read = () => JSON.parse(readFileSync(file, "utf8")) as Access;
    if (event.toolName.startsWith("mcp__")) {
      const decideMcp = () => {
        try {
          return connectorDecision(JSON.parse(readFileSync(join(home, "nucode/connectors.json"), "utf8")) as Connector[], event.toolName, process.env.NUCODE_SUBAGENT_DEPTH && process.env.NUCODE_TOOL_ACCESS === "read-only" ? "read-only" : read().accessMode, ctx.hasUI && !process.env.NUCODE_SUBAGENT_DEPTH);
        } catch { return "block"; }
      };
      const decision = decideMcp();
      if (decision === "allow") return;
      if (decision === "block") return { block: true, reason: "Connector tool blocked by nucode policy" };
      const title = "nucode:approval:" + JSON.stringify({ toolCallId: event.toolCallId, tool: event.toolName, command: event.toolName, cwd: ctx.cwd });
      const answer = await ctx.ui.select(title, ["Allow", "Block"]);
      if (answer !== "Allow" || decideMcp() === "block") return { block: true, reason: "Connector call denied" };
      return;
    }
    // Strict tool-call layers send every optional field; OMP service mode rejects any bash timeout.
    if (process.env.NUCODE_OMP === "1" && event.toolName === "bash" && typeof input.name === "string" && input.name.trim()) delete input.timeout;
    const call = { tool: preview ? "bash" : event.toolName, cwd: ctx.cwd, command: input.command as string, path: input.path as string };
    // A write or edit is judged on every file it writes. An OMP edit names them inside its payload ("[path#TAG]"
    // sections, patch headers, move targets), so read them with OMP's own inspector; without one, refuse rather
    // than guess, since judging no path would judge the workspace folder.
    let targets: string[] = [];
    if (event.toolName === "edit") {
      const inspect = process.env.NUCODE_OMP === "1" ? await loadInspect() : undefined;
      if (process.env.NUCODE_OMP === "1" && !inspect) return { block: true, reason: "nucode could not read which files this edit writes" };
      targets = inspect ? editTargets(input, inspect) : typeof input.path === "string" ? [input.path] : [];
      if (!targets.length) return { block: true, reason: "nucode could not tell which files this edit writes" };
    // nucode's own devices keep the access-mode check they always had (a read-only thread starts no subagent).
    } else if (event.toolName === "write" && typeof input.path === "string" && !/^xd:\/\/(?:subagent|report_verification)$/.test(input.path)) targets = [input.path];
    const child = process.env.NUCODE_SUBAGENT_DEPTH ? { workspace: process.env.NUCODE_WORKSPACE!, toolAccess: process.env.NUCODE_TOOL_ACCESS ?? "read-only" } : undefined;
    const judged: string[] = [];
    for (const target of targets) {
      const result = judgedPath(target);
      if ("path" in result) { judged.push(result.path); continue; }
      const access = read();
      // OMP's session scratch (local://) holds no project or user file; a read-only thread still writes nothing.
      if (event.toolName === "write" && /^local:\/\//i.test(target) && access.accessMode !== "read-only" && child?.toolAccess !== "read-only") continue;
      const url = /:\//.test(target) && !/^[@:]*~/.test(target);
      // Other device and process URLs act with the shell's reach: Full access runs those unasked, a file URL never.
      if (!url || event.toolName !== "write" || child || access.accessMode === "read-only" || !ctx.hasUI) return { block: true, reason: result.refuse };
      if (access.accessMode === "full-access" && !/^[@:]*file:/i.test(target)) continue;
      const title = "nucode:approval:" + JSON.stringify({ toolCallId: event.toolCallId, tool: event.toolName, path: target, cwd: ctx.cwd });
      if (await ctx.ui.select(title, ["Allow", "Block"]) !== "Allow" || read().accessMode === "read-only") return { block: true, reason: "Blocked by user" };
    }
    if (targets.length && !judged.length) return;
    if (targets.length) call.path = judged.join(", ");
    const calls = targets.length ? judged.map(path => ({ ...call, path })) : [call];
    const decideAll = () => {
      const decisions = calls.map(c => decide(read(), c, home, ctx.hasUI, child));
      return decisions.includes("block") ? "block" : decisions.includes("ask") ? "ask" : "allow";
    };
    const decision = decideAll();
    if (decision === "allow") {
      if (call.tool === "bash" && !preview) input.command = ownedCommand(userHome(safeReadOnlyCommand(call.command)));
      return;
    }
    if (decision === "block") return { block: true, reason: "Blocked by nucode access policy (read-only, protected path, or no interactive approval)" };
    const title = "nucode:approval:" + JSON.stringify({ toolCallId: event.toolCallId, ...call, diffPreview: call.tool === "edit" ? JSON.stringify(event.input).slice(0, 4000) : undefined });
    // A session rule names one exact file, so an edit that writes several is approved once.
    const answer = await ctx.ui.select(title, read().kind === "work" || calls.length > 1 ? ["Allow", "Block"] : ["Allow", "Allow for session", "Block"]);
    // A mode change while the dialog was open must take effect before execution.
    if (decideAll() === "block") return { block: true, reason: "Thread access changed while awaiting approval" };
    if (answer === "Allow for session") {
      const access = read();
      const rule = normalizeRule(call);
      if (!access.sessionAllow.some(r => JSON.stringify(r) === JSON.stringify(rule))) access.sessionAllow.push(rule);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(access));
      renameSync(temp, file);
    }
    if (answer !== "Allow" && answer !== "Allow for session") return { block: true, reason: "Blocked by user" };
    if (call.tool === "bash" && !preview) input.command = ownedCommand(userHome(safeReadOnlyCommand(call.command)));
  });
}
