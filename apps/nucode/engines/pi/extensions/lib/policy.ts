import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, basename, join, resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export type Role = { name: string; description: string; model?: string; toolAccess: "read-only" | "full"; instructions: string; reasoningEffort?: string | null; commandRank?: "colonel" | "major" | "enlisted" | null };
export type Policy = { enabled?: boolean; mode?: "custom" | "chain-of-command"; maxConcurrent: number; maxPerTurn: number; maxDepth: number; maxRunMinutes?: number; dailyTokenLimit?: number; allowedModels: string[]; defaultModel?: string; roles: Role[]; models?: Record<string, string> };
export type Rule = { tool: string; command?: string; path?: string; cwd?: string };
export type Access = { accessMode: "read-only" | "ask" | "full-access"; sessionAllow: Rule[]; kind?: "work"; workspace?: string; readOnlyFolders?: string[]; skillRoot?: string };
export type Call = { tool: string; command?: string; path?: string; cwd: string };

export function readPolicy(): Policy {
  const home = process.env.PI_CODING_AGENT_DIR;
  if (!home) throw new Error("Missing managed agent home");
  const id = process.env.NUCODE_SESSION_KEY;
  if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation ID");
  const file = id && resolve(home, "nucode/policies", `${id}.json`);
  return JSON.parse(readFileSync(file && existsSync(file) ? file : resolve(home, "nucode/policy.json"), "utf8"));
}

// Resolve existing ancestors too: a new file below a symlink must not escape the workspace.
export function canonical(path: string): string {
  path = resolve(path);
  try {
    if (lstatSync(path).isSymbolicLink()) return canonical(resolve(dirname(path), readlinkSync(path)));
    // The native call returns the on-disk case: ".GIT/config" on a case-insensitive disk is ".git/config".
    return realpathSync.native(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(path);
  return parent === path ? path : resolve(canonical(parent), basename(path));
}
export function inside(path: string, root: string): boolean {
  const rel = relative(canonical(root), canonical(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function protectedPath(path: string, home: string): boolean {
  // macOS and Windows disks ignore case by default, so ".ENV" and ".Git" are the files the names protect.
  return [resolve(path), canonical(path)].some(p => p.split(sep).some(part => part.toLowerCase() === ".git" || part.toLowerCase().startsWith(".env")) || inside(p, home));
}
export function readOnlyCommand(command: string): boolean {
  // Deliberately small grammar: no shell expansion, redirects, pipelines or executable flags.
  if (!/^[\w\s./:@,=+-]+$/.test(command) || /[\r\n]/.test(command)) return false;
  const [tool, ...args] = command.trim().split(/\s+/);
  if (tool === "git") {
    const [sub, ...rest] = args;
    return ["status", "diff", "log"].includes(sub) && rest.every(a => !a.startsWith("-") || /^(--(?:short|stat|name-only|name-status|oneline|no-ext-diff|no-textconv|cached|staged)|-[0-9]+)$/.test(a));
  }
  const flags: Record<string, RegExp> = { ls: /^-[alhRdt]+$/, cat: /^-[nbEsTv]+$/, rg: /^(-[niIlwFc]+|--(?:files|hidden|no-ignore))$/, grep: /^-[niIlwFErc]+$/, pwd: /^-[LP]$/ };
  return !!flags[tool] && args.every(a => !a.startsWith("-") || a === "--" || flags[tool].test(a));
}
export function normalizeRule(call: Call): Rule {
  // Exact normalized command is the safest command prefix (no wildcard or shell suffix).
  return call.tool === "bash"
    ? { tool: "bash", command: call.command?.trim(), cwd: canonical(call.cwd) }
    : { tool: call.tool, path: canonical(resolve(call.cwd, call.path ?? "")) };
}
export function safeReadOnlyCommand(command: string): string {
  if (!readOnlyCommand(command) || !command.trim().startsWith("git ")) return command;
  const [_, sub, ...args] = command.trim().split(/\s+/);
  return ["git", "--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", sub, ...(["diff", "log"].includes(sub) ? ["--no-ext-diff", "--no-textconv"] : []), ...args].join(" ");
}
// macOS Seatbelt profile for read-only children. Commands run (tests, scripts, git) but may write only to
// their own scratch folder, cannot resolve or reach hosts beyond this machine, cannot change preferences and
// cannot use the clipboard. Two limits remain and are documented: Seatbelt cannot stop Apple Events here (macOS
// still asks the user before one app automates another), and a service already listening on localhost runs
// outside the sandbox. As defence in depth, the programs that drive other apps or the keychain may not start.
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const seatbeltString = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
export function readOnlyProfile(scratch: string): string {
  return [
    "(version 1)", "(allow default)",
    // Signals may reach only processes in the same sandbox, not the engine or other apps.
    "(deny signal)", "(allow signal (target same-sandbox))",
    "(deny file-write*)",
    `(allow file-write* (subpath ${seatbeltString(scratch)}) (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
    // bash 3.2 writes here-documents to /private/var/tmp/sh-thd-<n> whatever TMPDIR says.
    '(allow file-write-data (literal "/private/var/tmp"))', '(allow file-write* (regex #"^/private/var/tmp/sh-thd-[0-9]+$"))',
    // A "local ip" filter on outbound traffic matches any destination, so outbound is matched by remote address
    // only. Without the mDNSResponder socket, names other than those in /etc/hosts do not resolve.
    "(deny network*)",
    '(allow network-bind network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    `(allow network-bind network-inbound network-outbound (local unix-socket (subpath ${seatbeltString(scratch)})) (remote unix-socket (subpath ${seatbeltString(scratch)})))`,
    '(deny mach-lookup (global-name "com.apple.cfprefsd.daemon") (global-name "com.apple.cfprefsd.agent") (global-name "com.apple.pasteboard.1") (global-name "com.apple.coreservices.appleevents") (global-name "com.apple.windowserver.active") (global-name "com.apple.replayd") (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc") (global-name "com.apple.coreservices.launchservicesd") (global-name-regex #"^com\\.apple\\.lsd\\."))',
    // Opening a file or app through Launch Services would run it outside the sandbox.
    "(deny lsopen)",
    '(deny process-exec (literal "/usr/bin/osascript") (literal "/usr/bin/open") (literal "/usr/bin/automator") (literal "/usr/bin/shortcuts") (literal "/usr/bin/security") (literal "/usr/bin/pbcopy") (literal "/usr/bin/pbpaste") (literal "/usr/sbin/screencapture"))',
  ].join(" ");
}
export function readOnlySandbox(): boolean {
  return process.platform === "darwin" && existsSync(SANDBOX_EXEC);
}
export function sandboxedCommand(command: string, scratch: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // macOS mktemp ignores TMPDIR, so a shim sends it to the scratch folder; build caches go there too.
  const shim = join(scratch, "bin", "mktemp");
  if (!existsSync(shim)) { mkdirSync(join(scratch, "bin"), { recursive: true }); writeFileSync(shim, '#!/bin/sh\nfor a in "$@"; do case $a in /*) exec /usr/bin/mktemp "$@";; esac; done\nexec /usr/bin/mktemp -p "${TMPDIR%/}" "$@"\n', { mode: 0o755 }); }
  const env = [`TMPDIR=${quote(scratch + "/")}`, `PATH=${quote(join(scratch, "bin"))}:"$PATH"`, "PYTHONDONTWRITEBYTECODE=1", ...Object.entries({ PYTHONPYCACHEPREFIX: "pycache", CARGO_TARGET_DIR: "cargo-target", GOCACHE: "go-cache", GOTMPDIR: "", XDG_CACHE_HOME: "cache" }).map(([name, sub]) => `${name}=${quote(sub ? join(scratch, sub) : scratch)}`)];
  const unset = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].map(name => `-u ${name}`).join(" ");
  // A later command runs in a new sandbox and cannot signal this one's jobs, so jobs it leaves behind stop with it.
  const body = `trap 'trap "" TERM; kill -TERM 0 2>/dev/null' EXIT\n${command}`;
  return `/usr/bin/env ${unset} ${env.join(" ")} ${SANDBOX_EXEC} -p ${quote(readOnlyProfile(scratch))} /bin/bash -c ${quote(body)}`;
}
// Work file boundaries also apply to children. Full access authorizes shell
// execution; the shared protected-path and child restrictions still apply.
export function workDecision(access: Access, call: Call, interactive: boolean, child = false): "allow" | "ask" | "block" | undefined {
  if (access.kind !== "work") return;
  if (!access.workspace || !inside(call.cwd, access.workspace)) return "block";
  const path = resolve(call.cwd, call.path ?? ".");
  const readable = (p: string) => [access.workspace!, ...(access.readOnlyFolders ?? []), ...(access.skillRoot ? [access.skillRoot] : [])].some(root => inside(p, root));
  if (["read", "ls", "find", "grep"].includes(call.tool)) return readable(path) ? "allow" : "block";
  if (call.tool === "bash") {
    if (readOnlyCommand(call.command ?? "")) return (call.command ?? "").trim().split(/\s+/).slice(1).filter(p => !p.startsWith("-")).every(p => readable(resolve(call.cwd, p))) ? "allow" : "block";
    if (access.accessMode === "read-only") return "block";
    if (access.accessMode === "full-access") return;
    return interactive && !child ? "ask" : "block";
  }
  if (!inside(path, access.workspace)) return "block";
  if (access.accessMode === "read-only") return "block";
  const outputs = resolve(access.workspace, "outputs");
  const inOutputs = canonical(outputs) === resolve(canonical(access.workspace), "outputs") && inside(path, outputs);
  if (existsSync(path) && !inOutputs && access.accessMode !== "full-access") return interactive && !child ? "ask" : "block";
}
export function decide(access: Access, call: Call, home: string, interactive: boolean, child?: { workspace: string; toolAccess: string }): "allow" | "ask" | "block" {
  const work = workDecision(access, call, interactive, !!child);
  if (work) return work;
  const path = resolve(call.cwd, call.path ?? "");
  const readonly = call.tool === "bash" && readOnlyCommand(call.command ?? "");
  if (access.accessMode === "read-only" || child?.toolAccess === "read-only") return readonly ? "allow" : "block";
  const command = (call.command ?? "").replace(/\$(?:NUCODE_WORK_PYTHON\b|\{NUCODE_WORK_PYTHON\})/g, "");
  // Naming .git or .env only to leave it out (rsync/tar --exclude, grep --exclude-dir) writes nothing there; a review
  // script's "rsync --exclude .git" stopped a Full access thread for approval. Any other mention still asks, in
  // any case, since the file system ignores case.
  const unexcluded = command.replace(/--exclude(?:-dir)?(?:=|\s+)(['"]?)\.(?:git|env)[\w.-]*\1(?=[\s;|&)]|$)/gi, "");
  const protectedWrite = call.tool === "bash"
    ? !readonly && /(^|[\s/'"])(\.git(?:[/\s'";]|$)|\.env)|PI_CODING_AGENT_DIR|NUCODE_|nucode\/threads/i.test(unexcluded) || command.includes(home)
    : protectedPath(path, home);
  if (protectedWrite) return interactive && !child ? "ask" : "block";
  if (child && access.accessMode === "ask") return readonly || (call.tool !== "bash" && inside(path, child.workspace)) ? "allow" : "block";
  if (access.accessMode === "full-access") return "allow";
  if (access.accessMode !== "ask") return "block";
  const rule = JSON.stringify(normalizeRule(call));
  if (access.sessionAllow.some(r => JSON.stringify(r) === rule)) return "allow";
  return interactive ? "ask" : "block";
}
export function commandRank(name: string, roles: Role[]): string | undefined {
  if (["colonel", "major", "enlisted"].includes(name)) return name;
  const rank = roles.find(role => role.name === name)?.commandRank;
  return name !== "commander" && rank && ["colonel", "major", "enlisted"].includes(rank) ? rank : undefined;
}
export function commandTargets(role: string, roles: Role[]): string[] {
  const rank = role === "commander" ? role : commandRank(role, roles);
  const allowed = rank === "commander" ? ["colonel", "major", "enlisted"] : rank === "colonel" ? ["major", "enlisted"] : [];
  return roles.filter(role => allowed.includes(commandRank(role.name, roles) ?? "")).map(role => role.name);
}
export function commandInstructions(role: string, roles: Role[] = []): string {
  const instructions: Record<string, string> = {
    commander: "You are the commander in Chain of Command mode. Define the goal, constraints and acceptance criteria. Delegate bounded work to colonels or enlisted agents using their configured models. Prefer a configured specialist when its description matches the task. Use a major-rank role for independent verification before reporting completion; give it the acceptance criteria and artifact paths. If the agent budget prevents QA, report that limitation instead of claiming verification. Keep handoffs concise and include paths and evidence; avoid repeating whole transcripts. You own integration and the final response.",
    colonel: "You are a colonel. Break the assigned goal into bounded, non-overlapping tasks for enlisted agents. Prefer a configured specialist when its description matches the task. Reserve budget for a major-rank role to verify the result, or explicitly return unverified work to the commander. Integrate results and report artifacts, checks and remaining risks. Do not delegate recursively to another colonel.",
    major: "You are a QA major. Independently check the supplied acceptance criteria against the actual artifacts. Run the available checks within your tool permissions. Report pass/fail evidence and unresolved risks with report_verification, using observed evidence IDs and the reviewed artifact paths. Do not claim a check ran when it did not. You cannot delegate; return necessary fixes to your commander or colonel.",
    enlisted: "You are an enlisted implementation agent. Complete only the bounded assigned task, preserve unrelated work, and run relevant checks. Return concise artifact paths, changes, evidence and blockers. You cannot delegate.",
  };
  const rank = role === "commander" ? role : commandRank(role, roles);
  return (rank && instructions[rank] ? (role !== rank ? `Your role is ${role}, with ${rank} rank. ` : "") + instructions[rank] + (rank === "commander" || rank === "colonel" ? " Pass explicit acceptanceCriteria to each major, each one checkable from the current files and commands rather than a claim about earlier steps. The last agent a turn may start is kept for a major, so spend it on the final check. Run QA after implementation and before your final response; later commands or edits require another review. Text-only claims do not satisfy verification." : "") : "Unknown Chain of Command role. Delegation is blocked.");
}
// Atomic directory creation shares a finite budget across independent child processes.
// The last place is kept for a major, so a team that spends its turn building and fixing can still verify.
export function reserveSubagent(directory: string, limit: number, major = true): void {
  const open = major || limit < 3 ? limit : limit - 1;
  for (let i = 0; i < open; i++) {
    try { mkdirSync(resolve(directory, String(i))); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  throw new Error(`Subagent max per turn (${limit}) reached across the command tree${open < limit ? "; the last agent is kept for a major to verify the work" : ""}`);
}
export function createSubagentBudget(home: string, limit: number): string {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid managed concurrency limit");
  const directory = mkdtempSync(resolve(home, "nucode/subagent-turn-"));
  try {
    writeFileSync(resolve(directory, "concurrency"), String(limit));
    for (let i = 0; i < limit; i++) writeFileSync(resolve(directory, `slot-${i}-free`), "");
    return directory;
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
// Renaming a free token to a unique lease is atomic across processes. A stale
// cleanup can only release its own lease, never a later occupant of that slot.
export async function acquireSubagentSlot(directory: string, signal?: AbortSignal): Promise<string> {
  const limit = Number(readFileSync(resolve(directory, "concurrency"), "utf8"));
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid managed concurrency limit");
  while (true) {
    if (signal?.aborted) throw new Error("Subagent aborted");
    for (let i = 0; i < limit; i++) {
      const lease = resolve(directory, `slot-${i}-${process.pid}-${randomUUID()}`);
      try { renameSync(resolve(directory, `slot-${i}-free`), lease); return lease; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const name of readdirSync(directory)) {
      const owner = /^slot-\d+-(\d+)-/.exec(name);
      if (owner) try { process.kill(Number(owner[1]), 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") releaseSubagentSlot(resolve(directory, name)); }
    }
    await delay(25, undefined, { signal });
  }
}
export function adoptSubagentSlot(lease: string): string {
  const slot = /^slot-(\d+)-\d+-/.exec(basename(lease));
  if (!slot) throw new Error("Invalid managed subagent slot");
  const owned = resolve(dirname(lease), `slot-${slot[1]}-${process.pid}-${randomUUID()}`);
  renameSync(lease, owned);
  return owned;
}
export function releaseSubagentSlot(lease?: string): void {
  if (!lease) return;
  const slot = /^slot-(\d+)-\d+-/.exec(basename(lease));
  if (!slot) throw new Error("Invalid managed subagent slot");
  try { renameSync(lease, resolve(dirname(lease), `slot-${slot[1]}-free`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export function releaseSubagentProcessSlots(directory: string, pid: number): void {
  let names: string[];
  try { names = readdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const name of names) if (/^slot-\d+-(\d+)-/.exec(name)?.[1] === String(pid)) releaseSubagentSlot(resolve(directory, name));
}
// The model ids a subagent may use, as the subagent tool accepts them.
export function modelChoices(policy: Policy): string[] {
  const enabled = Object.keys(policy.models ?? {});
  return policy.allowedModels.length ? policy.allowedModels.filter(m => !policy.models || enabled.includes(m)) : enabled;
}
// Models see their own provider's registry id (nucode-<provider>/<id>) and often drop the provider, so accept
// those for the policy id: an exact registry id, or an id without the provider that exactly one provider has.
export function canonicalModel(policy: Policy, model: string): string {
  const models = policy.models;
  model = model.trim();
  if (!models || models[model]) return model;
  const byActual = Object.keys(models).find(id => models[id] === model);
  if (byActual) return byActual;
  const byName = Object.keys(models).filter(id => id.slice(id.indexOf("/") + 1) === model);
  return byName.length === 1 ? byName[0] : model;
}
export function resolveTask(policy: Policy, task: { agent: string; model?: string | null }, parent?: string, parentRole = "commander") {
  if (policy.mode === "chain-of-command" && !commandTargets(parentRole, policy.roles).includes(task.agent)) throw new Error(`${parentRole} cannot delegate to ${task.agent} in Chain of Command mode`);
  const role = policy.roles.find(r => r.name === task.agent);
  if (!role) throw new Error(`Unknown role ${task.agent}. Available: ${policy.roles.map(r => r.name).join(", ")}`);
  const configured = role.model || policy.defaultModel || parent;
  const requested = task.model ? canonicalModel(policy, task.model) : undefined;
  if (policy.mode === "chain-of-command" && requested && requested !== configured) throw new Error(`Chain of Command uses the configured ${task.agent} model (${configured ?? "not set"}); change it in agent policy`);
  const model = requested || configured;
  const choices = () => { const list = modelChoices(policy); return list.length ? ` Use one of: ${list.join(", ")}` : ""; };
  if (!model || !/^[^/]+\/.+$/.test(model)) throw new Error(`Select a provider/model for the subagent.${choices()}`);
  if (policy.allowedModels.length && !policy.allowedModels.includes(model)) throw new Error(`Model ${model} is not allowed. Allowed models: ${policy.allowedModels.join(", ")}`);
  if (policy.models && !policy.models[model]) throw new Error(`Model ${model} is not enabled in the provider registry.${choices()}`);
  const actual = policy.models?.[model] ?? model;
  const slash = actual.indexOf("/");
  return { role, model, provider: actual.slice(0, slash), modelId: actual.slice(slash + 1) };
}
export function checkLimits(policy: Policy, depth: number, count: number) {
  if (policy.enabled === false) throw new Error("Subagents are disabled");
  for (const field of ["maxConcurrent", "maxPerTurn", "maxDepth"] as const) if (!Number.isInteger(policy[field]) || policy[field] < 1) throw new Error(`Invalid ${field}`);
  if (!Number.isInteger(depth) || depth < 0 || depth >= policy.maxDepth) throw new Error(`Subagent max depth (${policy.maxDepth}) reached`);
  if (count >= policy.maxPerTurn) throw new Error(`Subagent max per turn (${policy.maxPerTurn}) reached`);
}
