import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTargets, judgedPath, setInspect, userPath, type Inspect } from "../extensions/lib/toolPaths.ts";
import { protectedPath } from "../extensions/lib/policy.ts";
import gate from "../extensions/nucode-gate.ts";

const root = mkdtempSync(join(tmpdir(), "nucode-toolpaths-"));
const home = join(root, "agent");
const user = join(root, "user");
const cwd = join(root, "workspace");
mkdirSync(join(home, "nucode/threads"), { recursive: true });
mkdirSync(user);
mkdirSync(join(cwd, ".git"), { recursive: true });
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

// Stands in for OMP's native inspector, which loads only inside the engine: hashline headers and moves.
const hashline: Inspect = (mode, args) => {
  if (mode !== "hashline") throw new Error("not this mode");
  const text = String(JSON.parse(args).input ?? "");
  const lines = text.split("\n").filter(line => !line.startsWith("+"));
  const paths = lines.map(line => line.match(/^\[(.+?)(?:#[0-9A-F]{4})?\]$/)?.[1]).filter(Boolean) as string[];
  const moves = lines.map(line => line.match(/^MV (.+)$/)?.[1]).filter(Boolean).map(to => ({ path: paths.at(-1), to }));
  return { paths, fileOps: moves };
};

test("a tilde path names the user's home, and spellings that move a write are refused", () => {
  assert.equal(userPath("~/notes.md", user), `${user}/notes.md`);
  assert.equal(userPath("~/notes.md:1-20", user), `${user}/notes.md:1-20`);
  assert.equal(userPath("@~/notes.md", user), `${user}/notes.md`);
  assert.equal(userPath("~", user), user);
  for (const path of ["~other/x", "notes/~/x", "/abs/x", "rel/x"]) assert.equal(userPath(path, user), path);
  assert.equal(userPath("~/x", ""), "~/x");
  // OMP's own rewrites before it opens a file: header brackets, unicode spaces, a leading "@" or ":".
  assert.deepEqual(judgedPath("[/a/b.ts#1F5E]"), { path: "/a/b.ts" });
  assert.deepEqual(judgedPath("[/a/b.ts]"), { path: "/a/b.ts" });
  assert.deepEqual(judgedPath("@/a/b"), { path: "/a/b" });
  assert.deepEqual(judgedPath(":/a/b"), { path: "/a/b" });
  assert.deepEqual(judgedPath("/Application Support/x"), { path: "/Application Support/x" });
  assert.deepEqual(judgedPath("@my-file.txt"), { path: "@my-file.txt" });
  assert.deepEqual(judgedPath(":../x"), { path: "../x" });
  assert.deepEqual(judgedPath(":./x"), { path: "./x" });
  for (const path of ["~", "~name/x", ":~name/x", "[~/x#1F5E]", "file:///etc%2Fhosts", "@file:///x", "file:/x", "vault://k", "proc://job", "x/local://y.md"]) assert.ok("refuse" in judgedPath(path), path);
});

test("protected names are matched without regard to case", () => {
  for (const path of [".GIT/config", ".Git/hooks/pre-commit", ".ENV", ".Env.local"]) assert.ok(protectedPath(join(cwd, path), home), path);
  assert.ok(!protectedPath(join(cwd, "src/git.ts"), home));
});

test("every file an edit writes comes from the inspector, read as every edit mode", () => {
  const seen: string[] = [];
  const inspect: Inspect = (mode, args) => { seen.push(mode); return mode === "apply_patch" ? { paths: ["a.txt"], fileOps: [{ path: "a.txt", to: "/tmp/b.txt" }] } : hashline(mode, args); };
  assert.deepEqual(editTargets({ input: "[src/a.ts#1F5E]\nPUT 1.=1:\n+[/etc/x#ABCD]\n[/outside/b.ts]\nMV ../c.ts" }, inspect).sort(), ["../c.ts", "/outside/b.ts", "/tmp/b.txt", "a.txt", "src/a.ts"]);
  assert.deepEqual(seen, ["hashline", "apply_patch", "sloppy", "patch", "replace"]);
  assert.deepEqual(editTargets({ path: "x.ts", old_string: "a", new_string: "b" }, () => ({})), ["x.ts"]);
});

test("the gate judges OMP writes and edits by the files they write", async (t) => {
  const keys = ["NUCODE_OMP", "NUCODE_CHAT", "NUCODE_WORK", "PI_CODING_AGENT_DIR", "NUCODE_SESSION_KEY", "NUCODE_SUBAGENT_DEPTH", "NUCODE_TOOL_ACCESS", "NUCODE_WORKSPACE", "NUCODE_USER_HOME"];
  const previous = keys.map(key => process.env[key]);
  t.after(() => { keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]); setInspect(undefined); });
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NUCODE_OMP: "1", PI_CODING_AGENT_DIR: home, NUCODE_SESSION_KEY: "paths", NUCODE_USER_HOME: user });
  const policy = join(home, "nucode/threads/paths.json");
  const setMode = (accessMode: string) => writeFileSync(policy, JSON.stringify({ accessMode, sessionAllow: [] }));
  let handler: any;
  gate({ on: (name: string, fn: any) => { if (name === "tool_call") handler = fn; } } as any);
  const titles: any[] = [];
  let answer = "Block";
  const ctx = { cwd, hasUI: true, ui: { select: async (title: string, options: string[]) => { titles.push({ ...JSON.parse(title.slice("nucode:approval:".length)), options }); return answer; } } };
  const edit = (input: string) => ({ toolName: "edit", toolCallId: "edit", input: { input } });
  const write = (path: string) => ({ toolName: "write", toolCallId: "write", input: { path, content: "x" } });
  const body = "\nPUT 1.=1:\n+x";
  const blocked = async (event: any, context: any) => (await handler(event, context))?.block === true;

  // Reads are not gated in Code mode, but a tilde path still has to reach the user's file.
  setMode("full-access");
  const read = { path: "~/project/roadmap.md:1-120" };
  assert.equal(await handler({ toolName: "read", toolCallId: "read", input: read }, ctx), undefined);
  assert.equal(read.path, `${user}/project/roadmap.md:1-120`);

  // Without OMP's inspector an edit's files are unknown, so it is refused rather than judged as the workspace.
  setInspect(undefined);
  assert.equal((await handler(edit(`[src/inside.ts#1F5E]${body}`), ctx)).reason, "nucode could not read which files this edit writes");
  setInspect(hashline);

  // A subagent in Ask mode may write only inside its workspace. Each spelling below reached the thread's own
  // access policy (or a file outside the workspace) before, because the gate judged a different path than OMP wrote.
  setMode("ask");
  Object.assign(process.env, { NUCODE_SUBAGENT_DEPTH: "1", NUCODE_TOOL_ACCESS: "full", NUCODE_WORKSPACE: cwd });
  const child = { ...ctx, hasUI: false };
  assert.equal(await handler(edit(`[src/inside.ts#1F5E]${body}`), child), undefined);
  assert.equal(await handler(write("src/new.ts"), child), undefined);
  for (const input of [`[/outside/file.ts#1F5E]${body}`, `[src/inside.ts#1F5E]${body}\n[${policy}#0000]${body}`, `[src/inside.ts#1F5E]\nMV ../escaped.ts`, `[~/nucode/threads/paths.json#1F5E]${body}`, `[file:///${policy.slice(1).replaceAll("/", "%2F")}#1F5E]${body}`, `[:../agent/nucode/threads/paths.json#1F5E]${body}`, `[src/inside.ts#1F5E]\nMV :../escaped.ts`, body])
    assert.ok(await blocked(edit(input), child), input);
  for (const path of [`[${policy}]`, `@${policy}`, `:${policy}`, "~nucode/threads/paths.json", ":~nucode/threads/paths.json", "~/outside.txt", ".GIT/config", ".ENV", "proc://job", "vault://key", `file://${policy}`, ":../agent/nucode/threads/paths.json"])
    assert.ok(await blocked(write(path), child), path);
  assert.equal(await handler(write("local://notes.md"), child), undefined);

  // The parent is asked about the real file, a file URL is never written unasked, and a multi-file edit is
  // never remembered as one session rule.
  for (const key of ["NUCODE_SUBAGENT_DEPTH", "NUCODE_TOOL_ACCESS", "NUCODE_WORKSPACE"]) delete process.env[key];
  setMode("full-access");
  assert.equal(await handler(edit(`[src/inside.ts#1F5E]${body}`), ctx), undefined);
  assert.ok(await blocked(edit(`[${home}/nucode/connectors.json#1F5E]${body}`), ctx));
  assert.equal(titles.at(-1).path, `${home}/nucode/connectors.json`);
  assert.ok(await blocked(write(`/Users/x/../..${home.replaceAll(" ", " ")}/nucode/threads/paths.json`), ctx));
  assert.equal(await handler(write("proc://job"), ctx), undefined);
  assert.ok(await blocked(write(`file://${policy}`), ctx));
  assert.equal(titles.at(-1).path, `file://${policy}`);
  setMode("ask");
  assert.ok(await blocked(edit(`[a.ts#1F5E]${body}\n[b.ts#0000]${body}`), ctx));
  assert.equal(titles.at(-1).path, "a.ts, b.ts");
  assert.deepEqual(titles.at(-1).options, ["Allow", "Block"]);
  assert.ok(await blocked(edit(`[a.ts#1F5E]${body}`), ctx));
  assert.deepEqual(titles.at(-1).options, ["Allow", "Allow for session", "Block"]);
  answer = "Allow";
  assert.equal(await handler(write("proc://job"), ctx), undefined);
  assert.equal(titles.at(-1).path, "proc://job");
  // nucode's own devices keep their access-mode check: a read-only thread starts no subagent.
  setMode("read-only");
  assert.ok(await blocked(write("local://notes.md"), ctx));
  assert.ok(await blocked({ toolName: "write", toolCallId: "sub", input: { path: "xd://subagent", content: "{}" } }, ctx));
});
