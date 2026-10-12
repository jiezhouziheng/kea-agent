import assert from "node:assert/strict";
import { test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN_URL = new URL("../src/main.ts", import.meta.url);
const MAIN_PATH = fileURLToPath(MAIN_URL);

function importExpression(url: URL): string {
  return [
    'if (!process.versions.bun) throw new Error("child is not running under Bun");',
    `await import(${JSON.stringify(url.href)});`,
  ].join("\n");
}

function runWithFakeTui(
  home: string,
  ui: "tui" | "cli",
  fakeModule: string,
): SpawnSyncReturns<string> {
  const program = `
    Bun.plugin({
      name: "kea-main-fake-tui",
      setup(build) {
        build.onResolve({ filter: /run-tui\\.js$/ }, () => ({
          path: "run-tui",
          namespace: "kea-main-test",
        }));
        build.onLoad({ filter: /.*/, namespace: "kea-main-test" }, () => ({
          contents: ${JSON.stringify(fakeModule)},
          loader: "js",
        }));
      },
    });
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    const { main } = await import(${JSON.stringify(MAIN_URL.href)});
    await main(["--ui", ${JSON.stringify(ui)}, ${JSON.stringify(PROJECT_ROOT)}]);
  `;
  return spawnSync(process.execPath, ["--eval", program], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
    input: "/exit\n",
    timeout: 10_000,
  });
}

test("importing main is silent and does not open readline", () => {
  const child = spawnSync(
    process.execPath,
    ["--eval", importExpression(MAIN_URL)],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("explicit TUI fails before bootstrap when stdin or stdout is not interactive", () => {
  const home = mkdtempSync(join(tmpdir(), "kea-main-tui-"));
  try {
    const child = spawnSync(
      process.execPath,
      [MAIN_PATH, "--ui", "tui"],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: "utf8",
      },
    );

    assert.equal(child.status, 1);
    assert.match(child.stderr, /TUI requires interactive stdin and stdout/i);
    assert.match(child.stderr, /--ui cli/);
    assert.equal(existsSync(join(home, ".kea")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("default TUI fails before user configuration in a non-interactive terminal", () => {
  const home = mkdtempSync(join(tmpdir(), "kea-main-default-tui-"));
  try {
    const child = spawnSync(process.execPath, [MAIN_PATH], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /TUI requires interactive stdin and stdout/i);
    assert.match(child.stderr, /--ui cli/);
    assert.equal(existsSync(join(home, ".kea")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("main loads only the selected UI and redacts TUI lifecycle failures", () => {
  const home = mkdtempSync(join(tmpdir(), "kea-main-selection-"));
  try {
    const keaHome = join(home, ".kea");
    mkdirSync(keaHome);
    writeFileSync(
      join(keaHome, "config.json"),
      JSON.stringify({
        defaultModel: { provider: "openai", model: "test-model" },
        providers: { openai: { protocol: "openai", models: ["test-model"] } },
      }),
    );
    writeFileSync(
      join(keaHome, "auth.json"),
      JSON.stringify({ providers: { openai: { apiKey: "secret-key" } } }),
    );

    const tui = runWithFakeTui(
      home,
      "tui",
      'export async function runTui() { console.log("fake TUI selected"); }',
    );
    assert.equal(tui.status, 0, tui.stderr);
    assert.match(tui.stdout, /fake TUI selected/);

    const cli = runWithFakeTui(home, "cli", 'throw new Error("TUI module was evaluated")');
    assert.equal(cli.status, 0, cli.stderr);
    assert.doesNotMatch(cli.stderr, /TUI module was evaluated/);

    const failed = runWithFakeTui(
      home,
      "tui",
      'export async function runTui() { throw new Error("lifecycle exposed secret-key"); }',
    );
    assert.equal(failed.status, 1);
    assert.doesNotMatch(failed.stderr, /secret-key/);
    assert.equal(failed.stderr.match(/\[REDACTED\]/g)?.length, 1, failed.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15_000);

test("explicit CLI without user configuration falls back to init templates", () => {
  const home = mkdtempSync(join(tmpdir(), "kea-main-"));
  try {
    const run = (): SpawnSyncReturns<string> =>
      spawnSync(
        process.execPath,
        [MAIN_PATH, "--ui", "cli"],
        {
          cwd: PROJECT_ROOT,
          env: { ...process.env, HOME: home, USERPROFILE: home },
          encoding: "utf8",
        },
      );

    const first = run();
    assert.match(first.stdout, /config\.json: created/);
    assert.match(first.stdout, /auth\.json: created/);
    assert.equal(existsSync(join(home, ".kea", "config.json")), true);
    assert.equal(existsSync(join(home, ".kea", "auth.json")), true);
    // Credentials still have to be filled in before the run can proceed.
    assert.equal(first.status, 1, first.stderr);
    assert.match(first.stderr, /must be non-empty/);

    // Existing files are never re-created or reported again.
    const second = run();
    assert.doesNotMatch(second.stdout, /created/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
