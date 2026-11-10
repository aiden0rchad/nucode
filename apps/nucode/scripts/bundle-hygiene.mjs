import { readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export function removePythonCaches(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name === "__pycache__" || /\.py[co]$/.test(entry.name)) {
      rmSync(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) removePythonCaches(path);
  }
}

export function checkBundleHygiene(root) {
  const home = Buffer.from(homedir());
  const files = [], problems = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === "__pycache__" || /\.py[co]$/.test(entry.name)) {
        problems.push(`${relative(root, path)}: Python cache`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        files.push(path);
        if (readFileSync(path).includes(home)) problems.push(`${relative(root, path)}: builder home path`);
      }
    }
  }
  visit(root);
  if (problems.length) throw new Error(`Bundle contains private paths or Python caches:\n${problems.join("\n")}`);
  return files;
}
