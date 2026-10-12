import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

assert.equal(process.versions.bun, "1.3.7");

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(repoRoot, "dist", "src", "index.js");
const mainPath = join(repoRoot, "dist", "src", "main.js");
const tuiPath = join(repoRoot, "dist", "src", "ui", "tui", "run-tui.js");

assert.equal(existsSync(indexPath), true, "missing dist/src/index.js");
assert.equal(existsSync(mainPath), true, "missing dist/src/main.js");
assert.equal(existsSync(tuiPath), true, "missing dist/src/ui/tui/run-tui.js");
assert.equal(existsSync(join(repoRoot, "dist", "tests")), false, "dist must not contain tests");
assert.match(readFileSync(mainPath, "utf8"), /^#!\/usr\/bin\/env bun\r?\n/u);

const expression = [
  'if (process.versions.bun !== "1.3.7") throw new Error("compiled child is not Bun 1.3.7");',
  `await import(${JSON.stringify(pathToFileURL(indexPath).href)});`,
  `await import(${JSON.stringify(pathToFileURL(mainPath).href)});`,
  'const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];',
  "const before = signals.map((signal) => process.listenerCount(signal));",
  `await import(${JSON.stringify(pathToFileURL(tuiPath).href)});`,
  "const after = signals.map((signal) => process.listenerCount(signal));",
  'if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("TUI import installed signal listeners");',
].join("\n");
const imported = spawnSync(process.execPath, ["--eval", expression], {
  cwd: repoRoot,
  encoding: "utf8",
});
assert.equal(imported.status, 0, imported.stderr);
assert.equal(imported.stdout, "");
assert.equal(imported.stderr, "");

const home = mkdtempSync(join(tmpdir(), "kea-dist-"));
try {
  const started = spawnSync(process.execPath, [mainPath, "--ui", "cli"], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  assert.equal(started.status, 1, started.stderr);
  assert.match(started.stdout, /config\.json: created/u);
  assert.match(started.stdout, /auth\.json: created/u);
  assert.match(started.stderr, /must be non-empty/u);
} finally {
  rmSync(home, { recursive: true, force: true });
}

const nonInteractiveHome = mkdtempSync(join(tmpdir(), "kea-dist-tui-"));
try {
  const started = spawnSync(process.execPath, [mainPath], {
    cwd: repoRoot,
    env: { ...process.env, HOME: nonInteractiveHome, USERPROFILE: nonInteractiveHome },
    encoding: "utf8",
  });
  assert.equal(started.status, 1, started.stderr);
  assert.equal(started.stdout, "");
  assert.match(started.stderr, /--ui cli/u);
  assert.equal(existsSync(join(nonInteractiveHome, ".kea")), false);
} finally {
  rmSync(nonInteractiveHome, { recursive: true, force: true });
}

console.log("dist verification passed");
