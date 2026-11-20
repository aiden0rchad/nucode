import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The engine runs with its own HOME (see commandGuard.ts), so OMP would read "~/notes.md" from the engine's
// folder. The user, and the prompt they wrote, mean their own. Bash already gets the user's HOME back.
export function userPath(path: string, home = process.env.NUCODE_USER_HOME): string {
  if (!home || process.platform === "win32") return path;
  const bare = path.replace(/^[:@](?=~(?:\/|$))/, "");
  return bare === "~" || bare.startsWith("~/") ? home + bare.slice(1) : path;
}

const UNICODE_SPACES = /[  -   　]/g;
/**
 * The path the policy judges for a file OMP will write, or why it can't be judged. OMP rewrites what the model
 * typed before it opens a file: it unwraps "[path#TAG]", turns unicode spaces into spaces, drops a leading ":" or
 * "@", expands "~" against the engine's own home and decodes file URLs. Mirroring all of it is fragile, so the
 * spellings that change where a file lands are refused, and the rest is judged as OMP will read it.
 */
export function judgedPath(raw: string): { path: string } | { refuse: string } {
  let path = raw.trimEnd();
  if (path.startsWith("[") && path.endsWith("]")) path = path.slice(1, -1).replace(/#[0-9A-Fa-f]{4}$/, "");
  path = path.replace(UNICODE_SPACES, " ").replace(/^[:@]+(?=[/~]|\.\.?\/)/, "");
  if (path.startsWith("~")) return { refuse: "Write the full path instead of ~: the engine's home folder is not the user's" };
  if (/[a-z][\w+.-]*:\/\//i.test(path) || /^[a-z][\w+.-]+:\//i.test(path)) return { refuse: "nucode judges file paths only; this target is a URL" };
  return { path };
}

type Inspection = { paths?: string[]; fileOps?: { path?: string; to?: string }[] };
export type Inspect = (mode: string, args: string) => Inspection;
let native: Promise<Inspect | undefined> | undefined;
// OMP reads an edit's target files with a native inspector. Using the same one means the gate judges the files
// OMP will write, not a guess at them. It ships beside the engine's runtime, so resolve it from there.
export function loadInspect(): Promise<Inspect | undefined> {
  native ??= (async () => {
    for (const from of [process.execPath, process.argv[1]].filter(Boolean)) {
      try {
        const mod = await import(pathToFileURL(createRequire(from).resolve("@oh-my-pi/pi-natives")).href);
        if (typeof mod.editInspect === "function") return mod.editInspect as Inspect;
      } catch { /* try the next anchor */ }
    }
    return undefined;
  })();
  return native;
}
/** Tests stand in for the native inspector, which only loads inside the engine. */
export function setInspect(inspect: Inspect | undefined) { native = Promise.resolve(inspect); }

// The edit tool's payload format depends on its configured mode, which the gate can't see; reading it as every
// mode and taking the union judges each file any reading names.
const MODES = ["hashline", "apply_patch", "sloppy", "patch", "replace"];
/** Every file an edit call writes, as written in the call: targets and move destinations. */
export function editTargets(input: Record<string, unknown>, inspect: Inspect): string[] {
  const found = new Set<string>();
  const add = (p: unknown) => { if (typeof p === "string" && p.trim()) found.add(p); };
  add(input.path);
  for (const mode of MODES) {
    try {
      const result = inspect(mode, JSON.stringify(input));
      result.paths?.forEach(add);
      result.fileOps?.forEach(op => { add(op.path); add(op.to); });
    } catch { /* not this mode's format */ }
  }
  return [...found];
}
