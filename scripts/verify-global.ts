import assert from "node:assert/strict";
import {
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertGlobalPackageReferenceRemoved } from "./global-package-manifest.js";

assert.equal(process.versions.bun, "1.3.7");

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), "kea-global-"));
const packDir = join(root, "pack");
const globalDir = join(root, "global");
const globalBin = join(root, "bin");
const homeDir = join(root, "home");
const projectDir = join(root, "project");
for (const directory of [packDir, globalDir, globalBin, homeDir, projectDir]) {
  mkdirSync(directory);
}

function run(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

const inheritedPath = Object.entries(process.env)
  .find(([name]) => name.toLowerCase() === "path")?.[1] ?? "";
const inheritedEnv: NodeJS.ProcessEnv = {};
for (const [name, value] of Object.entries(process.env)) {
  if (name.toLowerCase() !== "path") inheritedEnv[name] = value;
}
const isolatedEnv: NodeJS.ProcessEnv = {
  ...inheritedEnv,
  BUN_INSTALL_GLOBAL_DIR: globalDir,
  BUN_INSTALL_BIN: globalBin,
  HOME: homeDir,
  USERPROFILE: homeDir,
  PATH: `${globalBin}${delimiter}${inheritedPath}`,
};

let installed = false;
try {
  const preview = run(["pm", "pack", "--dry-run", "--ignore-scripts"], repoRoot);
  run(["pm", "pack", "--destination", packDir, "--ignore-scripts"], repoRoot);

  const packedPaths = preview.stdout
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = /^packed\s+\S+\s+(.+)$/u.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    });

  const metadata = new Set(["package.json", "README.md", "LICENSE", "LICENSE.md"]);

  for (const required of [
    "package.json",
    "dist/src/index.js",
    "dist/src/main.js",
    "dist/src/ui/tui/run-tui.js",
  ]) {
    assert.ok(packedPaths.includes(required), `pack preview is missing ${required}`);
  }
  for (const path of packedPaths) {
    assert.ok(
      metadata.has(path) || path.startsWith("dist/"),
      `unexpected packed path: ${path}`,
    );
  }

  const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, `expected one tarball, got ${tarballs.join(", ")}`);
  const tarball = join(packDir, tarballs[0]!);

  run(["install", "--global", tarball], projectDir, isolatedEnv);
  installed = true;

  const installedMain = join(
    globalDir,
    "node_modules",
    "kea-agent",
    "dist",
    "src",
    "main.js",
  );
  const installedTui = join(
    globalDir,
    "node_modules",
    "kea-agent",
    "dist",
    "src",
    "ui",
    "tui",
    "run-tui.js",
  );
  assert.equal(existsSync(installedMain), true, "installed main.js is missing");
  assert.equal(existsSync(installedTui), true, "installed TUI entry is missing");
  assert.match(readFileSync(installedMain, "utf8"), /^#!\/usr\/bin\/env bun\r?\n/u);

  const launcherNames = readdirSync(globalBin)
    .filter((name) => /^kea(?:\.exe|\.cmd)?$/iu.test(name));
  assert.equal(launcherNames.length, 1, `expected one kea launcher: ${launcherNames.join(", ")}`);
  const launcher = join(globalBin, launcherNames[0]!);
  const launcherArtifactNames = readdirSync(globalBin)
    .filter((name) => /^kea(?:\.bunx|\.exe|\.cmd)?$/iu.test(name));

  const launch = (args: readonly string[]): SpawnSyncReturns<string> =>
    process.platform === "win32" && launcher.toLowerCase().endsWith(".cmd")
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `"${launcher}" ${args.join(" ")}`.trim()],
          { cwd: projectDir, env: isolatedEnv, encoding: "utf8" },
        )
      : spawnSync(launcher, [...args], {
          cwd: projectDir,
          env: isolatedEnv,
          encoding: "utf8",
        });

  const defaultLaunch = launch([]);
  assert.equal(defaultLaunch.status, 1, defaultLaunch.stderr);
  assert.equal(defaultLaunch.stdout, "");
  assert.match(defaultLaunch.stderr, /--ui cli/u);
  assert.equal(existsSync(join(homeDir, ".kea")), false);

  const cliLaunch = launch(["--ui", "cli"]);
  assert.equal(cliLaunch.status, 1, cliLaunch.stderr);
  assert.match(cliLaunch.stdout, /config\.json: created/u);
  assert.match(cliLaunch.stdout, /auth\.json: created/u);
  assert.match(cliLaunch.stderr, /must be non-empty/u);
  assert.deepEqual(
    readdirSync(join(homeDir, ".kea")).sort(),
    ["auth.json", "config.json"],
  );

  const installedUrl = pathToFileURL(installedMain).href;
  const installedTuiUrl = pathToFileURL(installedTui).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--eval",
      [
        'if (process.versions.bun !== "1.3.7") throw new Error("installed child is not Bun 1.3.7");',
        'const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];',
        "const before = signals.map((signal) => process.listenerCount(signal));",
        `await import(${JSON.stringify(installedUrl)});`,
        `await import(${JSON.stringify(installedTuiUrl)});`,
        "const after = signals.map((signal) => process.listenerCount(signal));",
        'if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("installed TUI import installed signal listeners");',
      ].join("\n"),
    ],
    { cwd: projectDir, env: isolatedEnv, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");

  run(["remove", "--global", "kea-agent"], projectDir, isolatedEnv);
  installed = false;
  assert.equal(
    existsSync(join(globalDir, "node_modules", "kea-agent")),
    false,
    "global package remains after uninstall",
  );
  assertGlobalPackageReferenceRemoved(join(globalDir, "package.json"));
  // Bun 1.3.7 on Windows leaves these shims after reporting a successful removal.
  // The package-state assertions above prevent this isolated cleanup from masking that failure.
  for (const name of launcherArtifactNames) {
    const artifact = join(globalBin, name);
    assert.equal(dirname(artifact), globalBin, `launcher escaped isolated bin: ${artifact}`);
    rmSync(artifact, { force: true });
  }
  assert.equal(
    readdirSync(globalBin).some((name) => /^kea(?:\.bunx|\.exe|\.cmd)?$/iu.test(name)),
    false,
    "global launcher remains after uninstall",
  );
} finally {
  if (installed) {
    spawnSync(process.execPath, ["remove", "--global", "kea-agent"], {
      cwd: projectDir,
      env: isolatedEnv,
      encoding: "utf8",
    });
  }
  rmSync(root, { recursive: true, force: true });
}
