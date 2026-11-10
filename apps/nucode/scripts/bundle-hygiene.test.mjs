import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBundleHygiene, removePythonCaches } from "./bundle-hygiene.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "nucode-bundle-hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

test("staging removes nested Python caches throughout the tree and preserves sources", t => {
  const root = fixture(t, {
    "node/npm/node-gyp/__pycache__/module.pyc": "cache",
    "node/npm/node-gyp/__pycache__/other.txt": "cache contents",
    "node/npm/legacy.pyc": "cache",
    "uv/nested/legacy.pyo": "cache",
    "node/npm/module.py": "source",
    "node/bin/node": Buffer.from([0, 255, 1]),
  });
  mkdirSync(join(root, "empty/__pycache__"), { recursive: true });
  const outside = fixture(t, { "__pycache__/keep.pyc": "outside staging" });
  symlinkSync(outside, join(root, "linked"), "junction");
  removePythonCaches(root);
  for (const path of ["node/npm/node-gyp/__pycache__", "node/npm/legacy.pyc", "uv/nested/legacy.pyo", "empty/__pycache__"]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  assert.equal(readFileSync(join(root, "node/npm/module.py"), "utf8"), "source");
  assert.deepEqual(readFileSync(join(root, "node/bin/node")), Buffer.from([0, 255, 1]));
  assert.equal(existsSync(join(outside, "__pycache__/keep.pyc")), true);
  removePythonCaches(root);
});

test("bundle validation lists all caches and home paths, including binary contents", t => {
  const root = fixture(t, {
    "Contents/Resources/config.txt": `prefix ${homedir()}/build suffix`,
    "Contents/MacOS/helper": Buffer.concat([Buffer.from([0, 255]), Buffer.from(homedir()), Buffer.from([0, 254])]),
    "Contents/Resources/__pycache__/cached.pyc": "cache",
    "Contents/Resources/legacy.pyo": "cache",
  });
  mkdirSync(join(root, "empty/__pycache__"), { recursive: true });
  assert.throws(() => checkBundleHygiene(root), error => {
    for (const path of ["Contents/Resources/config.txt", "Contents/MacOS/helper", "Contents/Resources/__pycache__", "Contents/Resources/__pycache__/cached.pyc", "Contents/Resources/legacy.pyo", "empty/__pycache__"]) {
      assert(error.message.includes(path), path);
    }
    assert(error.message.includes("builder home path"));
    return true;
  });
});

test("clean bundles return every regular file for signing checks", t => {
  const root = fixture(t, { "Contents/Resources/module.py": "source", "Contents/MacOS/helper": Buffer.from([0, 255, 0]) });
  assert.deepEqual(checkBundleHygiene(root).sort(), [join(root, "Contents/MacOS/helper"), join(root, "Contents/Resources/module.py")].sort());
});
