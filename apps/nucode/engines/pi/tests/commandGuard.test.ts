import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ownedCommand } from "../extensions/lib/commandGuard.ts";

const script = fileURLToPath(new URL("../extensions/lib/commandGuard.ts", import.meta.url));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

for (const omp of [false, true]) test(`command supervision preserves shell input, environment and exit status: ${omp ? "OMP" : "Pi"}`, { skip: process.platform === "win32" }, async () => {
  const original = process.env.NUCODE_OMP;
  if (omp) process.env.NUCODE_OMP = "1"; else delete process.env.NUCODE_OMP;
  const command = ownedCommand("printf '%s\\n' \"$NU_TEST_LITERAL\"; exit 37");
  if (original === undefined) delete process.env.NUCODE_OMP; else process.env.NUCODE_OMP = original;
  if (omp) { assert.ok(!command.startsWith("exec ")); assert.ok(!command.includes('"$0"')); }
  const child = spawn("/bin/bash", ["-c", command], { env: { ...process.env, NU_TEST_LITERAL: "quotes ' \" ` $()\nsecond line" } });
  let output = ""; child.stdout.on("data", data => { output += data; });
  const [code] = await once(child, "close");
  assert.equal(code, 37);
  assert.equal(output, "quotes ' \" ` $()\nsecond line\n");
});

for (const mode of ["cancel", "crash", "stubborn", "managed-stop", "managed-crash"]) test(`foreground process stops: ${mode}`, { skip: process.platform === "win32", timeout: 10000 }, async t => {
  const managed = mode.startsWith("managed-");
  const timer = `${quote(process.execPath)} -e ${quote(`${mode === "stubborn" || managed ? "process.on('SIGTERM',()=>{});" : ""}console.log('READY '+process.pid); setInterval(()=>{},1000)`)} | cat`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `
    import {spawn} from 'node:child_process';
    const guard=spawn(process.execPath,[${JSON.stringify(script)},String(process.pid),'/bin/bash',${JSON.stringify(timer)},...${JSON.stringify(managed ? ["--shared-group"] : [])}],{detached:${managed},stdio:['ignore','inherit','inherit']});
    process.stdout.write('GUARD '+guard.pid+'\\n'); setInterval(()=>{},1000);
  `], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", guard = 0, worker = 0;
  t.after(() => { for (const pid of [parent.pid, guard, worker]) if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } });
  for await (const data of parent.stdout) {
    output += data;
    guard = Number(/GUARD (\d+)/.exec(output)?.[1]);
    worker = Number(/READY (\d+)/.exec(output)?.[1]);
    if (guard && worker) break;
  }
  assert.ok(guard && worker, output);
  process.kill(mode === "managed-stop" ? -guard : mode === "cancel" ? guard : parent.pid!, mode === "cancel" ? "SIGTERM" : "SIGKILL");
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    try { process.kill(worker, 0); } catch { return; }
    // Linux can retain an already-dead orphan as a zombie until init reaps it.
    if (process.platform === "linux") try {
      if (/\) Z /.test(readFileSync(`/proc/${worker}/stat`, "utf8"))) return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail("foreground command survived its owner");
});

test("project commands get the user's HOME back while the engine keeps its own", async () => {
  const { userHome } = await import("../extensions/lib/commandGuard.ts");
  const previous = process.env.NUCODE_USER_HOME;
  try {
    delete process.env.NUCODE_USER_HOME;
    assert.equal(userHome("npm test"), "npm test");
    process.env.NUCODE_USER_HOME = "/Users/someone's home";
    const wrapped = userHome("npm test");
    assert.equal(wrapped, "export HOME='/Users/someone'\\''s home'; unset XDG_CONFIG_HOME\nnpm test");
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("/bin/bash", ["-c", userHome('printf "%s|%s" "$HOME" "${XDG_CONFIG_HOME-unset}"')], { env: { ...process.env, HOME: "/isolated", XDG_CONFIG_HOME: "/isolated" } }).toString();
    assert.equal(out, "/Users/someone's home|unset");
  } finally {
    if (previous === undefined) delete process.env.NUCODE_USER_HOME; else process.env.NUCODE_USER_HOME = previous;
  }
});

test("the guard runs its command when started through a symlinked path", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-link-"));
  try {
    const link = join(dir, "commandGuard.ts");
    symlinkSync(script, link);
    const child = spawn(process.execPath, [link, String(process.pid), "/bin/bash", "echo ran; exit 5", "--shared-group"]);
    let output = ""; child.stdout.on("data", data => { output += data; });
    const [code] = await once(child, "close");
    assert.equal(output, "ran\n");
    assert.equal(code, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
