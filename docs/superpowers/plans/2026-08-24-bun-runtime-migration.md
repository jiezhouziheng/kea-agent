# Bun Runtime Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Kea's root package from Node/npm to Bun 1.3.7 while retaining `tsc -> dist`, preserving all existing behavior, and keeping the globally runnable `kea` CLI.

**Architecture:** Bun becomes the only package manager, script runner, test runner, and application runtime. TypeScript remains the compiler, source tests run through `bun:test`, and separate verification scripts validate production artifacts and an isolated tarball-based global install. The migration changes delivery mechanics only; Session, AgentHarness, Project, ApplicationRuntime, and UserInteraction ownership stay unchanged.

**Tech Stack:** Bun 1.3.7, TypeScript 7.0.2, `bun:test`, TypeBox, official OpenAI/Anthropic/Gemini SDKs, GitHub Actions, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-24-bun-runtime-migration-design.md`

## Global Constraints

- Bun 1.3.7 is the sole supported package manager, script runner, test runner, and runtime.
- Invoke TypeScript as `bun --bun tsc`; plain `tsc` may honor its Node shebang.
- Keep `tsc -> dist`; do not introduce `bun build`, bundling, or a TypeScript bin entry.
- The repository ends with exactly one root `bun.lock` and no `package-lock.json`.
- Run tests directly from `tests/**/*.test.ts` through `bun:test`; tests must pass with no `dist/` directory.
- Keep `@types/node`, `NodeNext`, `node:*`, and existing `node:assert/strict` where needed for Bun's compatibility APIs. They are not Node runtime fallbacks.
- Do not add `trustedDependencies` speculatively. If a canonical SDK test fails and the output identifies a blocked lifecycle script, stop; record the package, script, and failure; authorize only that package; regenerate `bun.lock`; then rerun the affected SDK test, typecheck, the full suite, `verify:dist`, and `verify:global`.
- Do not add a Node/npm fallback to scripts, CI, shebangs, or current-facing documentation.
- Do not introduce a `BunRuntime` domain abstraction or change current Kea ownership boundaries.
- OpenTUI remains deferred; the feasibility `spike/` directory has been deleted.
- Preserve the existing `/models` removal and regression test in `src/ui/commands.ts` and `tests/ui/commands.test.ts`; only change the test runner import mechanically in that test.
- Preserve all unrelated dirty-worktree changes. Do not reset, overwrite, or auto-commit user-owned files.
- Historical plans, earlier specs, REFLECTION entries, and existing dated log/process entries remain historical; append new evidence instead of rewriting them.

## File Structure

New focused files:

- `bunfig.toml`: root Bun test discovery configuration.
- `tsconfig.build.json`: production-only TypeScript emit configuration.
- `scripts/clean.ts`: cross-platform `dist/` cleanup executed by Bun.
- `scripts/verify-dist.ts`: compiled artifact and Bun-runtime smoke verification.
- `scripts/verify-global.ts`: isolated pack/install/run/uninstall verification.
- `tests/toolchain.test.ts`: root manifest, Bun config, and first-party fallback regression checks.
- `src/core/util/path.ts`: narrow normalization for Bun's Windows drive-root `realpath` result.
- `bun.lock`: sole root dependency lockfile.

Existing file groups:

- `package.json`, `tsconfig.json`, `.gitignore`, `src/main.ts`: root toolchain and executable boundary.
- All 41 `tests/**/*.test.ts` files importing `node:test`: Bun runner migration.
- `.github/workflows/ci.yml`, `.gitlab-ci.yml`: Bun CI entrypoints.
- `README.md`, `SPEC.md`, `PLAN.md`, `docs/architecture.md`, `docs/coding-agent/project.md`, and `docs/coding-agent/startup.md`: current-facing truth.
- `SPEC_PROCESS.md` and `AGENT_LOG.md`: append-only implementation evidence. The Bun design spec receives one status-metadata update plus an appended implementation-evidence section; its existing design body is not rewritten.

---

### Task 1: Establish the root Bun package and production build boundary

**Files:**

- Create: `tests/toolchain.test.ts`
- Create: `bunfig.toml`
- Create: `tsconfig.build.json`
- Create: `scripts/clean.ts`
- Create: `bun.lock` through Bun's package manager
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Delete after verification: `package-lock.json`

**Interfaces:**

- Produces package scripts: `clean`, `typecheck`, `build`, `test`, `start`, `verify:dist`, `verify:global`.
- Produces build contract: `bun run build` emits only `src/**` beneath `dist/`, preserving `dist/src/main.js`.
- Produces test discovery contract: bare `bun test` scans only `tests/`.
- Later tasks implement the two verification scripts referenced by the manifest.

- [ ] **Step 1: Add a failing root-toolchain regression test**

Create `tests/toolchain.test.ts` with Bun-native assertions over the manifest and config files:

```ts
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("the root package has one Bun-only execution path", async () => {
  expect(process.versions.bun).toBe("1.3.7");
  const pkg = JSON.parse(await text("package.json")) as {
    packageManager?: string;
    engines?: Record<string, string>;
    files?: string[];
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  expect(pkg.packageManager).toBe("bun@1.3.7");
  expect(pkg.engines?.node).toBeUndefined();
  expect(pkg.files).toEqual(["dist"]);
  expect(pkg.bin).toEqual({ kea: "dist/src/main.js" });
  expect(pkg.scripts).toEqual({
    clean: "bun scripts/clean.ts",
    typecheck: "bun --bun tsc --noEmit",
    build: "bun run clean && bun --bun tsc -p tsconfig.build.json",
    test: "bun test",
    start: "bun dist/src/main.js",
    "verify:dist": "bun scripts/verify-dist.ts",
    "verify:global": "bun scripts/verify-global.ts",
  });
});

test("Bun discovers only root source tests", async () => {
  const bunfig = (await text("bunfig.toml")).replaceAll("\r\n", "\n");
  expect(bunfig).toBe('[test]\nroot = "tests"\n');
});
```

- [ ] **Step 2: Run the targeted test and observe the old-toolchain failure**

Run:

```powershell
bun test ./tests/toolchain.test.ts
```

Expected: FAIL because `packageManager`, Bun scripts, `files`, and `bunfig.toml` do not exist yet. The failure must be metadata-related, not a failure to start Bun.

- [ ] **Step 3: Create the Bun configuration and production-only TypeScript configuration**

Create `bunfig.toml` exactly:

```toml
[test]
root = "tests"
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests/**/*.ts", "scripts/**/*.ts"]
}
```

Create `scripts/clean.ts`:

```ts
import { rm } from "node:fs/promises";

await rm(new URL("../dist", import.meta.url), {
  recursive: true,
  force: true,
});
```

Change `tsconfig.json` from `"types": ["node"]` to `"types": ["node", "bun"]`, and extend `include` to:

```json
["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"]
```

- [ ] **Step 4: Replace the root package metadata and scripts**

Update `package.json` to:

```json
{
  "name": "kea-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.7",
  "files": ["dist"],
  "bin": {
    "kea": "dist/src/main.js"
  },
  "sideEffects": false,
  "scripts": {
    "clean": "bun scripts/clean.ts",
    "typecheck": "bun --bun tsc --noEmit",
    "build": "bun run clean && bun --bun tsc -p tsconfig.build.json",
    "test": "bun test",
    "start": "bun dist/src/main.js",
    "verify:dist": "bun scripts/verify-dist.ts",
    "verify:global": "bun scripts/verify-global.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.112.3",
    "@google/genai": "2.12.0",
    "openai": "6.48.0",
    "typebox": "1.3.6"
  },
  "devDependencies": {
    "@types/bun": "1.3.7",
    "@types/node": "24.13.3",
    "typescript": "7.0.2"
  }
}
```

Do not add `trustedDependencies`.

Update `.gitignore`: rename the `Node dependencies and build output` comment to `Dependencies and build output`, keep `node_modules/` and `dist/`, add `*.tgz`, and do not ignore `bun.lock`.

- [ ] **Step 5: Generate and inspect the Bun lockfile before removing npm's lockfile**

Run:

```powershell
bun --version
bun install
bun pm ls --all
bun pm untrusted
bun install --frozen-lockfile
```

Expected:

- Bun reports `1.3.7`.
- Direct versions match `package.json`, including `@types/bun@1.3.7`.
- The frozen install succeeds using `bun.lock`.
- `bun pm untrusted` lists `@google/genai`'s no-op preinstall and `protobufjs`'s `node scripts/postinstall`; leave both untrusted at this gate. If a later canonical SDK test fails with lifecycle-script-specific evidence, stop and investigate before changing `trustedDependencies`.

Only after this gate, delete `package-lock.json` and run `bun install --frozen-lockfile` again. Expected: success with no npm lockfile present.

- [ ] **Step 6: Verify the new build boundary and targeted metadata test**

Run:

```powershell
bun test ./tests/toolchain.test.ts
bun run typecheck
bun run build
Test-Path -LiteralPath dist/src/main.js
Test-Path -LiteralPath dist/tests
```

Expected: the toolchain test, typecheck, and production build all pass; the old Node test runner is not invoked; `dist/src/main.js` is `True`; `dist/tests` is `False`.

Review checkpoint: inspect `package.json`, `bun.lock`, both tsconfig files, and `.gitignore`. Do not commit automatically in the dirty shared worktree.

---

### Task 2: Migrate the behavior suite to Bun-native source tests

**Files:**

- Modify: all 41 files returned by `rg -l 'from "node:test"' tests`
- Modify specially: `tests/harness/session.test.ts`
- Modify specially: `tests/coding-agent/cli/project-directory.test.ts`
- Modify specially: `tests/coding-agent/config/templates.test.ts`
- Modify specially: `tests/import-smoke.test.ts`
- Modify specially: `tests/main.test.ts`
- Modify specially: `tests/ui/cli/cli-ui.test.ts`
- Modify specially: `tests/coding-agent/project/factory.test.ts`
- Create: `src/core/util/path.ts`
- Modify: `src/coding-agent/cli/project-directory.ts`
- Modify: `src/coding-agent/factory.ts`

**Interfaces:**

- Produces a build-independent `bun test` suite.
- Produces `normalizeWindowsDriveRoot(value: string): string`, used only at filesystem canonicalization boundaries.
- Preserves existing `.js` source-import specifiers and `node:assert/strict` assertions.

- [ ] **Step 1: Perform only the mechanical runner import change**

In each of the 41 test files, replace:

```ts
import test from "node:test";
```

with:

```ts
import { test } from "bun:test";
```

In `tests/harness/session.test.ts`, import `describe` as well:

```ts
import { describe, test } from "bun:test";
```

Do not alter `node:assert/strict`, compatible `node:*` imports, test assertions, or the existing `/models` regression content.

- [ ] **Step 2: Convert Node-only test registration semantics**

In `tests/harness/session.test.ts`, replace the parent test plus inner `await test(...)` loop with this declaration-time table:

```ts
const invalidAppends: Array<{
  readonly append: (session: Session) => Promise<unknown>;
  readonly name: string;
}> = [
  {
    name: "NaN assistant latency",
    append: (session) => session.append({
      type: "message",
      message: { ...assistant, latencyMs: Number.NaN },
    }),
  },
  {
    name: "infinite assistant token count",
    append: (session) => session.append({
      type: "message",
      message: {
        ...assistant,
        usage: { inputTokens: 1, outputTokens: Infinity, totalTokens: 2 },
      },
    }),
  },
  {
    name: "non-string model ID",
    append: (session) => session.append({
      type: "model_selection",
      selection: { provider: "test", model: null as unknown as string },
    }),
  },
];

describe("append rejects invalid runtime entries without changing the session", () => {
  test.each(invalidAppends)("$name", async ({ append }) => {
    const session = memorySession();
    await assert.rejects(append(session), isInvalidRecord);
    assert.deepEqual(session.messages(), []);
    assert.equal(session.modelSelection(), null);
    assert.equal(session.headId, null);
    assert.deepEqual(session.nodes, []);
  });
});
```

In `tests/coding-agent/cli/project-directory.test.ts`, replace Node's options object with:

```ts
test.skipIf(process.platform === "win32")(
  "empty successful Git output fails instead of falling back to the startup directory",
  async () => {
    const directory = await tempDir();
    const bin = await tempDir();
    const originalPath = process.env["PATH"];
    try {
      const git = join(bin, "git");
      await writeFile(git, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      process.env["PATH"] = bin;
      await assert.rejects(
        resolveProjectDirectory(directory),
        /Unable to determine the Git work-tree root/i,
      );
    } finally {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
      await rm(directory, { recursive: true, force: true });
      await rm(bin, { recursive: true, force: true });
    }
  },
);
```

In `tests/coding-agent/config/templates.test.ts`, use:

```ts
test.skipIf(process.platform === "win32")(
  "auth is created with owner-only permissions where supported",
  async () => {
    const keaHome = await tempDir();
    try {
      await initializeUserConfiguration(keaHome);
      const mode = (await stat(join(keaHome, "auth.json"))).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      await rm(keaHome, { recursive: true, force: true });
    }
  },
);
```

- [ ] **Step 3: Make import and main tests execute TypeScript source under Bun**

In `tests/import-smoke.test.ts`, add:

```ts
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_URL = new URL("../src/index.ts", import.meta.url);
const MAIN_URL = new URL("../src/main.ts", import.meta.url);

function importExpression(url: URL): string {
  return [
    'if (!process.versions.bun) throw new Error("child is not running under Bun");',
    `await import(${JSON.stringify(url.href)});`,
  ].join("\n");
}
```

Replace the two compiled-module child processes and the stale source read with:

```ts
const child = spawnSync(
  process.execPath,
  ["--eval", importExpression(INDEX_URL)],
  {
    cwd: PROJECT_ROOT,
    env: environment,
    encoding: "utf8",
  },
);
```

```ts
const child = spawnSync(
  process.execPath,
  ["--eval", importExpression(MAIN_URL)],
  { cwd: PROJECT_ROOT, encoding: "utf8" },
);
```

```ts
const source = readFileSync(MAIN_URL, "utf8");
```

In `tests/main.test.ts`, import `fileURLToPath` from `node:url` and define:

```ts
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN_URL = new URL("../src/main.ts", import.meta.url);
const MAIN_PATH = fileURLToPath(MAIN_URL);

function importExpression(url: URL): string {
  return [
    'if (!process.versions.bun) throw new Error("child is not running under Bun");',
    `await import(${JSON.stringify(url.href)});`,
  ].join("\n");
}
```

Use these child-process forms for silent import and entry execution respectively:

```ts
spawnSync(process.execPath, ["--eval", importExpression(MAIN_URL)], {
  cwd: PROJECT_ROOT,
  encoding: "utf8",
});
```

```ts
spawnSync(process.execPath, [MAIN_PATH], {
  cwd: PROJECT_ROOT,
  env: { ...process.env, HOME: home, USERPROFILE: home },
  encoding: "utf8",
});
```

No source test may refer to `dist/`.

- [ ] **Step 4: Harden process-global cleanup for Bun's shared test process**

In the SIGINT test in `tests/ui/cli/cli-ui.test.ts`, ensure both release and close execute even when an assertion fails:

```ts
const runPromise = ui.run();
try {
  for (let attempt = 0; attempt < 100 && !calls.includes("prompt:started"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(calls.includes("prompt:started"), "prompt never started");
  process.emit("SIGINT");
  assert.equal(harness.abortCalls, 1);
  release();
  await runPromise;
  assert.equal(harness.abortCalls, 1);
} finally {
  release();
  try {
    await runPromise;
  } finally {
    ui.close();
  }
}
```

Preserve the existing `try/finally` restoration of `PATH`, `GIT_CONFIG_GLOBAL`, and `GIT_CONFIG_NOSYSTEM` in project-directory tests. Do not enable permanent serial mode.

- [ ] **Step 5: Reproduce the Bun Windows drive-root incompatibility**

Run:

```powershell
bun test ./tests/coding-agent/project/factory.test.ts
```

On Windows/Bun 1.3.7, expected pre-fix failure:

```text
realpath("D:\\") === "D:"
ProjectError: Project directory must be absolute and normalized: D:
```

Do not skip or weaken the existing filesystem-root test.

- [ ] **Step 6: Normalize only Bun's Windows drive-root result**

Create `src/core/util/path.ts`:

```ts
export function normalizeWindowsDriveRoot(value: string): string {
  return process.platform === "win32" && /^[A-Za-z]:$/u.test(value)
    ? `${value}\\`
    : value;
}
```

In `src/coding-agent/cli/project-directory.ts`, import from `../../core/util/path.js` and change `requireDirectory()`'s successful assignment to:

```ts
real = normalizeWindowsDriveRoot(await realpath(path));
```

In `src/coding-agent/factory.ts`, import from `../core/util/path.js` and replace the boundary helper with:

```ts
async function requireProjectDirectory(input: string): Promise<string> {
  const projectDirectory = normalizeWindowsDriveRoot(input);
  if (
    !isAbsolute(projectDirectory)
    || resolve(projectDirectory) !== projectDirectory
  ) {
    throw new ProjectError(
      `Project directory must be absolute and normalized: ${input}`,
    );
  }
  let real: string;
  try {
    real = normalizeWindowsDriveRoot(await realpath(projectDirectory));
  } catch (error) {
    throw new ProjectError(`Project directory does not exist: ${projectDirectory}`, {
      cause: error,
    });
  }
  if (real !== projectDirectory) {
    throw new ProjectError(`Project directory must be canonical: ${projectDirectory}`);
  }
  const info = await stat(real);
  if (!info.isDirectory()) {
    throw new ProjectError(`Project directory is not a directory: ${real}`);
  }
  return real;
}
```

Preserve all existing missing/non-directory/canonical error categories.

Add `parse` and `resolve` to that test file's `node:path` import, then add this root-boundary assertion:

```ts
test("a filesystem root remains an absolute canonical directory", async () => {
  const root = parse(process.cwd()).root;
  assert.equal(await resolveProjectDirectory(root), resolve(root));
});
```

- [ ] **Step 7: Run focused Bun migration tests**

Run:

```powershell
bun run typecheck
bun test ./tests/harness/session.test.ts
bun test ./tests/coding-agent/cli/project-directory.test.ts ./tests/coding-agent/config/templates.test.ts
bun test ./tests/import-smoke.test.ts ./tests/main.test.ts
bun test ./tests/coding-agent/project/factory.test.ts
```

Expected: zero failures. Windows reports exactly the two documented platform skips across the full suite; focused subsets report the applicable skips only.

- [ ] **Step 8: Prove the whole suite is source-only and process-clean**

Run:

```powershell
bun run clean
bun test
if (Test-Path -LiteralPath dist) {
  throw "bun test must not create dist/"
}
bun test --rerun-each 3 ./tests/coding-agent/cli/project-directory.test.ts ./tests/ui/cli/cli-ui.test.ts
if (Test-Path -LiteralPath dist) {
  throw "repeated source tests must not create dist/"
}
```

Expected: all behavior tests pass; the two Windows-only skips remain; repeated tests show no listener/environment leak; `dist` remains `False`. Do not require Bun's printed test count to equal Node's 322 because the Node parent/subtest count becomes Bun parameterized cases.

Review checkpoint: inspect every non-mechanical test diff and the narrow Windows path normalization. Do not commit automatically.

---

### Task 3: Verify production artifacts under Bun

**Files:**

- Modify: `src/main.ts`
- Create: `scripts/verify-dist.ts`
- Test: `tests/toolchain.test.ts`

**Interfaces:**

- Consumes `bun run build` and the stable `dist/src/index.js` / `dist/src/main.js` paths.
- Produces `bun run verify:dist`, a no-network verification command independent of user credentials.

- [ ] **Step 1: Add the Bun executable-entry expectation**

Extend `tests/toolchain.test.ts`:

```ts
test("the production entrypoint selects Bun", async () => {
  expect(await text("src/main.ts")).toMatch(/^#!\/usr\/bin\/env bun\r?\n/u);
});
```

Run `bun test ./tests/toolchain.test.ts`. Expected: FAIL because `src/main.ts` still uses the Node shebang.

- [ ] **Step 2: Change the source shebang and implement compiled verification**

Change only the first line of `src/main.ts`:

```ts
#!/usr/bin/env bun
```

Create `scripts/verify-dist.ts` with these exact responsibilities:

```ts
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

assert.equal(existsSync(indexPath), true, "missing dist/src/index.js");
assert.equal(existsSync(mainPath), true, "missing dist/src/main.js");
assert.equal(existsSync(join(repoRoot, "dist", "tests")), false, "dist must not contain tests");
assert.match(readFileSync(mainPath, "utf8"), /^#!\/usr\/bin\/env bun\r?\n/u);

const expression = [
  'if (process.versions.bun !== "1.3.7") throw new Error("compiled child is not Bun 1.3.7");',
  `await import(${JSON.stringify(pathToFileURL(indexPath).href)});`,
  `await import(${JSON.stringify(pathToFileURL(mainPath).href)});`,
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
  const started = spawnSync(process.execPath, [mainPath], {
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

console.log("dist verification passed");
```

- [ ] **Step 3: Build and verify the exact production artifact**

Run:

```powershell
bun test ./tests/toolchain.test.ts
bun run build
bun run verify:dist
```

Expected: all commands pass; output contains `dist verification passed`; `dist/tests` does not exist; the compiled shebang is Bun.

Review checkpoint: confirm production imports remain side-effect free and no runtime probe was added to Kea's public application API.

---

### Task 4: Verify tarball-based global installation in isolation

**Files:**

- Create: `scripts/verify-global.ts`
- Verify unchanged: `package.json` retains `files: ["dist"]`

**Interfaces:**

- Consumes the production `dist/` tree and `package.json` `files: ["dist"]`.
- Produces `bun run verify:global`, which packs, installs, executes, removes, and cleans up without touching the developer's normal Bun global directory or home configuration.

- [ ] **Step 1: Implement a strict child-command helper and isolated directory layout**

Create `scripts/verify-global.ts` with these imports and isolated roots:

```ts
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
```

Define the strict success helper:

```ts
function run(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
```

Remove every case variant of the inherited PATH key, then construct one unambiguous child-only PATH. This prevents a Windows child from resolving a user-installed `kea` through an inherited `Path` entry:

```ts
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
```

Wrap Steps 2–4 in `let installed = false; try { ... } finally { ... }` so cleanup has an explicit installation-state guard.

- [ ] **Step 2: Pack and enforce the production-file whitelist**

Run these through the helper:

```ts
const preview = run(["pm", "pack", "--dry-run", "--ignore-scripts"], repoRoot);
run(["pm", "pack", "--destination", packDir, "--ignore-scripts"], repoRoot);
```

Parse the dry-run's `packed <size> <path>` lines and enforce the whitelist:

```ts
const packedPaths = preview.stdout
  .split(/\r?\n/u)
  .flatMap((line) => {
    const match = /^packed\s+\S+\s+(.+)$/u.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });

const metadata = new Set(["package.json", "README.md", "LICENSE", "LICENSE.md"]);

for (const required of ["package.json", "dist/src/index.js", "dist/src/main.js"]) {
  assert.ok(packedPaths.includes(required), `pack preview is missing ${required}`);
}
for (const path of packedPaths) {
  assert.ok(
    metadata.has(path) || path.startsWith("dist/"),
    `unexpected packed path: ${path}`,
  );
}
```

This rejects first-party source, tests, scripts, internal docs, CI files, `AGENTS.md`, and `CONTEXT.md`, while allowing npm-compatible package metadata.

Find exactly one `.tgz` in `packDir`; fail on zero or more than one:

```ts
const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
assert.equal(tarballs.length, 1, `expected one tarball, got ${tarballs.join(", ")}`);
const tarball = join(packDir, tarballs[0]!);
```

- [ ] **Step 3: Install, execute, and inspect the global package**

Install the tarball with:

```ts
run(["install", "--global", tarball], projectDir, isolatedEnv);
installed = true;
```

Resolve only the newly installed absolute paths:

```ts
const installedMain = join(
  globalDir,
  "node_modules",
  "kea-agent",
  "dist",
  "src",
  "main.js",
);
assert.equal(existsSync(installedMain), true, "installed main.js is missing");
assert.match(readFileSync(installedMain, "utf8"), /^#!\/usr\/bin\/env bun\r?\n/u);

const launcherNames = readdirSync(globalBin)
  .filter((name) => /^kea(?:\.exe|\.cmd)?$/iu.test(name));
assert.equal(launcherNames.length, 1, `expected one kea launcher: ${launcherNames.join(", ")}`);
const launcher = join(globalBin, launcherNames[0]!);
```

Run the launcher from `projectDir` using `isolatedEnv`. This command intentionally exits 1 because the isolated home contains empty generated credentials:

```ts
const launched = process.platform === "win32" && launcher.toLowerCase().endsWith(".cmd")
  ? spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `"${launcher}"`],
      { cwd: projectDir, env: isolatedEnv, encoding: "utf8" },
    )
  : spawnSync(launcher, [], {
      cwd: projectDir,
      env: isolatedEnv,
      encoding: "utf8",
    });
assert.equal(launched.status, 1, launched.stderr);
assert.match(launched.stdout, /config\.json: created/u);
assert.match(launched.stdout, /auth\.json: created/u);
assert.match(launched.stderr, /must be non-empty/u);
assert.deepEqual(
  readdirSync(join(homeDir, ".kea")).sort(),
  ["auth.json", "config.json"],
);
```

Separately assert the installed module imports silently under Bun 1.3.7:

```ts
const installedUrl = pathToFileURL(installedMain).href;
const imported = spawnSync(
  process.execPath,
  [
    "--eval",
    [
      'if (process.versions.bun !== "1.3.7") throw new Error("installed child is not Bun 1.3.7");',
      `await import(${JSON.stringify(installedUrl)});`,
    ].join("\n"),
  ],
  { cwd: projectDir, env: isolatedEnv, encoding: "utf8" },
);
assert.equal(imported.status, 0, imported.stderr);
assert.equal(imported.stdout, "");
assert.equal(imported.stderr, "");
```

- [ ] **Step 4: Uninstall and always clean the isolated tree**

Run:

```ts
run(["remove", "--global", "kea-agent"], projectDir, isolatedEnv);
installed = false;
assert.equal(
  readdirSync(globalBin).some((name) => /^kea(?:\.exe|\.cmd)?$/iu.test(name)),
  false,
  "global launcher remains after uninstall",
);
```

Use this exact cleanup branch around Steps 2–4; the cleanup uninstall's status is intentionally ignored because the original assertion failure must remain primary:

```ts
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
```

Do not call `bun install -g .` or `bun link -g`; Bun 1.3.7 on Windows was already observed to crash or create a broken link for those paths.

- [ ] **Step 5: Exercise the global workflow twice**

Run:

```powershell
bun run build
bun run verify:global
bun run verify:global
```

Expected: both runs pass, each uses a fresh temp root, global launcher removal is verified, and neither `~/.kea` nor the normal Bun global directory changes.

Review checkpoint: inspect the pack preview. If the lifecycle-script protocol in Global Constraints was triggered, record the exact evidence and rerun its entire required verification set; otherwise confirm no package was trusted.

---

### Task 5: Move both CI definitions to the Bun verification graph

**Files:**

- Modify: `tests/toolchain.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitlab-ci.yml`

**Interfaces:**

- Consumes the six canonical commands produced by Tasks 1–4.
- Produces GitHub Windows/Ubuntu/macOS coverage and a Bun-based GitLab Linux job.

- [ ] **Step 1: Add a failing first-party CI regression test**

Extend `tests/toolchain.test.ts`:

```ts
test("first-party CI uses the complete Bun verification graph", async () => {
  const github = await text(".github/workflows/ci.yml");
  const gitlab = await text(".gitlab-ci.yml");
  const commands = [
    "bun install --frozen-lockfile",
    "bun run typecheck",
    "bun test",
    "bun run build",
    "bun run verify:dist",
    "bun run verify:global",
  ];

  for (const command of commands) {
    expect(github).toContain(command);
    expect(gitlab).toContain(command);
  }
  expect(github).toContain("windows-latest");
  expect(github).toContain("ubuntu-latest");
  expect(github).toContain("macos-latest");
  expect(github).toContain("uses: oven-sh/setup-bun@v2");
  expect(github).toContain("bun-version: 1.3.7");
  expect(github).not.toContain("setup-node");
  expect(gitlab).toContain("image: oven/bun:1.3.7");
  expect(gitlab).toContain("apt-get install -y -qq --no-install-recommends git");
  expect(gitlab).not.toMatch(/\bnpm\b/u);
  expect(gitlab).not.toContain("node:24");
});
```

Run `bun test ./tests/toolchain.test.ts`. Expected: FAIL on both existing Node/npm CI definitions.

- [ ] **Step 2: Replace GitHub Actions with the three-platform matrix**

Use this job shape in `.github/workflows/ci.yml` while preserving current triggers and `contents: read` permissions:

```yaml
jobs:
  verify:
    name: verify (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
      - name: Set up Bun 1.3.7
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.7
      - name: Install locked dependencies
        run: bun install --frozen-lockfile
      - name: Typecheck
        run: bun run typecheck
      - name: Test source
        run: bun test
      - name: Build production artifacts
        run: bun run build
      - name: Verify production artifacts
        run: bun run verify:dist
      - name: Verify global package
        run: bun run verify:global
```

- [ ] **Step 3: Replace GitLab CI's Node image and npm cache**

Use:

```yaml
stages:
  - test

verify:
  stage: test
  image: oven/bun:1.3.7
  timeout: 20m
  cache:
    key:
      files:
        - bun.lock
    paths:
      - .bun/install/cache/
  variables:
    BUN_INSTALL_CACHE_DIR: "$CI_PROJECT_DIR/.bun/install/cache"
  before_script:
    - apt-get update -qq
    - apt-get install -y -qq --no-install-recommends git
  script:
    - bun install --frozen-lockfile
    - bun run typecheck
    - bun test
    - bun run build
    - bun run verify:dist
    - bun run verify:global
```

The pinned official Bun Debian image does not include Git, while Kea's tests execute `git init` and `git rev-parse`; keep the explicit installation. Do not invent GitLab Windows/macOS runners; GitHub owns the required OS matrix.

- [ ] **Step 4: Verify CI text and the full local graph**

Run:

```powershell
bun test ./tests/toolchain.test.ts
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run verify:dist
bun run verify:global
```

Expected: all commands pass locally on Windows. Remote Ubuntu/macOS success is established only when those configured GitHub jobs run; do not claim remote execution from YAML inspection alone.

Review checkpoint: confirm no Node/npm cache, setup, image, or command remains in either current CI definition.

---

### Task 6: Align current-facing requirements, permissions, and architecture documentation

**Files:**

- Modify test evidence: `tests/coding-agent/project/project.test.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `PLAN.md`
- Modify: `docs/architecture.md`
- Modify: `docs/coding-agent/project.md`
- Modify: `docs/coding-agent/startup.md`
- Already modified in Task 1: `.gitignore`

**Interfaces:**

- Consumes the implemented Bun command graph and current ApplicationRuntime/permission code.
- Produces current-facing documentation that matches code and Accepted ADRs 0001–0003.

- [ ] **Step 1: Correct the misleading Session-cwd test before documenting it**

In `tests/coding-agent/project/project.test.ts`, replace the misleading “must stay inside” test with executable evidence for the real behavior:

```ts
test("relative cwd resolves from the Project directory and an existing absolute cwd may be external", async () => {
  const { project, projectDir, prompts } = await makeProject();
  const externalDir = await tempDir();
  try {
    await mkdir(join(projectDir, "src"), { recursive: true });
    const relative = await project.createHarness({ cwd: "src" });
    const absolute = await project.createHarness({
      cwd: resolve(join(projectDir, "src")),
    });
    const external = await project.createHarness({ cwd: externalDir });
    assert.notEqual(relative.sessionId, absolute.sessionId);
    assert.notEqual(absolute.sessionId, external.sessionId);

    await relative.prompt("a");
    await absolute.prompt("b");
    await external.prompt("c");
    assert.ok(prompts[0]?.includes(resolve(join(projectDir, "src"))));
    assert.ok(prompts[1]?.includes(resolve(join(projectDir, "src"))));
    assert.ok(prompts[2]?.includes(resolve(externalDir)));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});
```

Run:

```powershell
bun test ./tests/coding-agent/project/project.test.ts
```

Expected: PASS, providing executable evidence for the documentation correction.

- [ ] **Step 2: Rewrite README commands and current security wording**

Update `README.md` so it states:

- Requirement: Bun 1.3.7; Windows still requires Git for Windows for the Bash tool.
- Source workflow:

```bash
bun install --frozen-lockfile
bun run build
bun run start
```

- Local private-package global workflow:

```bash
bun pm pack --filename kea-agent.tgz
bun install -g ./kea-agent.tgz
kea
bun remove -g kea-agent
```

- `bun install -g .` is unsupported for this Bun version; registry installation is documented only after publication.
- Development commands are `bun run typecheck`, `bun test`, `bun run build`, `bun run verify:dist`, and `bun run verify:global`; source tests do not require `dist/`.
- Project directory is trusted. External file/glob targets ask `Allow once` / `Always allow` / `Deny`; remembered directory approval lasts only for the in-memory Project lifetime and covers descendants, not siblings.
- Existing external Session cwd is allowed; Bash asks for cwd approval before command classification. Hard denies are not overridable, and absent/failed interaction denies approval-required work.
- These checks are governance, not a filesystem or shell sandbox.
- Remove nonexistent `src/core/events/`; describe per-Harness `HarnessEventBus`/`HarnessHooks` and `ApplicationRuntime`.

- [ ] **Step 3: Bring SPEC.md to the current architecture and Bun delivery contract**

Update current requirements, not historical design files. Cover these exact sections: §1, §2, §3, §4, §7, §8, US-5, the §11 ownership table, §12 threat table, §13 architecture/dependencies, §15 commands, §16 technology choices, and §17 acceptance criteria.

- Replace shared Project `Events`, `emit/intercept`, `shouldContinue`, `ToolDefinition`, and `src/core/events` with per-Harness `HarnessEventBus`, fixed `HarnessHooks`, `AgentTool`, TypeBox validation, and ApplicationRuntime's stable current-Harness subscription.
- Replace blanket external-path rejection with the exact approval behavior proven in Step 1 and existing permission tests.
- Remove any claim that Bash hard-deny is duplicated inside the Bash tool; the Project-owned `beforeTool` Hook owns policy.
- Replace Node/npm technology, test, CI, and distribution sections with Bun 1.3.7, `bun:test`, `tsc`, tarball installation, production-only `dist`, and three-platform CI.
- Record the pre-migration baseline as `npm test` on 2026-08-24: 322 total, 320 passed, 2 skipped, 0 failed. Do not copy 331/333 into current acceptance criteria.
- State that final Bun output must have zero failures and preserve behavior cases; do not require its printed count to equal 322.

- [ ] **Step 4: Update PLAN.md without rewriting task history**

Update the current goal/global constraints and Tasks 1–7 validation commands to Bun 1.3.7, `bun:test`, and direct TypeScript test targets. In Task 3, replace shared Events/interceptors and `src/core/events` with `HarnessEventBus`, `HarnessHooks`, `src/core/harness/events.ts`, and `hooks.ts`. In Task 5, correct paths and replace blanket external-path rejection with the approval semantics proven above.

Preserve Tasks 1–8 as implementation history, but mark root `PLAN.md` Task 8's npm distribution mechanism as superseded. Append Task 9 referencing ADR 0003 and the Bun migration spec, with the six CI verification commands and the tarball install/remove workflow. Replace final completion criteria with the post-migration Bun contract, but keep them count-free here; this migration plan's Task 7 records the actual Bun result after it has been observed.

- [ ] **Step 5: Extend current architecture and focused coding-agent docs**

In `docs/architecture.md`:

- Preserve the already-applied ApplicationRuntime corrections.
- Expand Project permission behavior with external directory approval, approval lifetime, and external Session cwd.
- State that tool path resolution itself is policy-free; Project's private `beforeTool` Hook authorizes access.
- Add a delivery section after startup: Bun 1.3.7 owns install/scripts/tests/runtime; `bun --bun tsc` emits production-only `dist`; tests execute TypeScript; `bun.lock` is sole lock; `node:*` imports are compatible Bun APIs; `dist/src/main.js` uses Bun shebang; local global distribution uses a tarball; GitHub covers three OSes; no domain-level Bun abstraction exists.

In `docs/coding-agent/project.md`, add a focused Session-cwd/external-directory permission section. In `docs/coding-agent/startup.md`, remove stale `Events`/`events/` domain paths and keep startup/config modules stateless.

- [ ] **Step 6: Run current-facing drift scans**

Run:

```powershell
rg -n -i 'npm (ci|install|run|test|start|uninstall)|node --test|node:test|Node\.js 24|src/core/events|shared `?Events|emit/intercept|331/333' package.json README.md SPEC.md PLAN.md docs/architecture.md docs/coding-agent .github/workflows/ci.yml .gitlab-ci.yml src/main.ts
git diff --check
```

Expected: no first-class obsolete workflow/architecture hits. Review matches manually: compatible `node:*`, `@types/node`, historical prose explicitly marked superseded, shell-policy fixture text such as `npm test`, and human wording such as “Node timer range” are not runtime fallbacks.

Review checkpoint: compare README, SPEC, PLAN, and architecture against code and ADRs 0001–0003. Do not alter earlier plan/spec history.

---

### Task 7: Record migration evidence without rewriting history

**Files:**

- Modify by appending: `SPEC_PROCESS.md`
- Modify by appending: `AGENT_LOG.md`
- Modify with observed result: `PLAN.md`
- Modify status/evidence: `docs/superpowers/specs/2026-08-24-bun-runtime-migration-design.md`
- Verify unchanged decision: `docs/adr/0003-adopt-bun-as-the-runtime-and-toolchain.md`
- Verify index: `docs/adr/README.md`

**Interfaces:**

- Consumes observed output from the final six-command verification graph.
- Produces a dated audit trail and marks the design implemented only after the evidence exists.

- [ ] **Step 1: Run the complete Windows verification and capture exact output**

Run:

```powershell
bun --version
bun install --frozen-lockfile
bun run typecheck
bun run clean
bun test
if (Test-Path -LiteralPath dist) {
  throw "bun test must not create dist/"
}
bun run build
bun run verify:dist
bun run verify:global
```

Record the exact Bun version, pass/fail/skip counts printed by Bun, build result, dist verification result, and global verification result. Expected: Bun 1.3.7, zero failures, exactly the two justified Windows skips, production build success, and both verification scripts passing.

- [ ] **Step 2: Append SPEC_PROCESS.md migration history**

Append a dated section covering:

- the earlier event/control split and ApplicationRuntime/UserInteraction decisions (ADRs 0001/0002);
- ADR 0003 and the explicit `tsc -> dist -> Bun` boundary;
- the exact pre-migration Node baseline: 322 tests, 320 passed, 2 skipped;
- the observed Bun result from Step 1;
- source test migration, Windows drive-root compatibility fix, tarball distribution, CI matrix, and why Node/npm fallback was rejected.

Do not edit its old SEA/npm/shared-Events sections.

- [ ] **Step 3: Append AGENT_LOG.md evidence**

Append separate dated evidence entries for:

- the 2026-08-20 per-Harness EventBus/Hooks split (`2daae96` through `afd968e`);
- ApplicationRuntime/UserInteraction (`ab3a2c1`, `fbe8481`, ADRs 0001/0002);
- the approved Bun design, changed files, actual verification commands/results, Bun 1.3.7 local-global-install limitations, and tarball workaround.

Record the complete migration-before baseline as `322 total / 320 pass / 2 skip / 0 fail`. Do not edit earlier 262/262 or 331/333 records.

- [ ] **Step 4: Mark the design implemented only after evidence is recorded**

Write the observed Bun result into root `PLAN.md` Task 9/completion evidence, then change only the design spec's status metadata from:

```text
设计已确认，等待实施。
```

to:

```text
设计已确认并完成实施。
```

Append an implementation-evidence section to the design spec with the exact commands/results, CI status, and tarball verification. Do not rewrite its design sections. Confirm ADR 0003 remains `accepted` and the ADR index still lists it. If implementation required a permanent Node fallback or a different runtime, stop instead and create a superseding ADR; do not silently edit ADR 0003's decision.

Review checkpoint: the new sections contain observed values, not planned values, and all older dated evidence remains unchanged.

---

### Task 8: Final repository audit and completion gate

**Files:**

- Verify all files changed by Tasks 1–7.
- Verify deleted: `package-lock.json`, `spike/`.
- Verify present: root `bun.lock` only.

**Interfaces:**

- Produces the final evidence needed to claim the Bun migration complete.

- [ ] **Step 1: Verify lockfiles and production output shape**

Run:

```powershell
$bunLocks = @(rg --hidden --no-ignore --files -g 'bun.lock*' -g '!.git/**' -g '!node_modules/**')
if ($bunLocks.Count -ne 1 -or $bunLocks[0] -ne 'bun.lock') {
  throw "expected exactly root bun.lock; got: $($bunLocks -join ', ')"
}
$npmLocks = @(rg --hidden --no-ignore --files -g 'package-lock.json' -g 'npm-shrinkwrap.json' -g '!.git/**' -g '!node_modules/**')
if ($npmLocks.Count -ne 0) {
  throw "npm lockfile remains: $($npmLocks -join ', ')"
}
Get-ChildItem -LiteralPath dist -Recurse -File | Select-Object -ExpandProperty FullName
if (Test-Path -LiteralPath spike) {
  throw "deleted spike/ directory has reappeared"
}
```

Expected: exactly root `bun.lock`; no npm lockfile; no `dist/tests`; `spike` is `False`.

- [ ] **Step 2: Run the final canonical command graph from the repository root**

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run clean
bun test
if (Test-Path -LiteralPath dist) {
  throw "bun test must not create dist/"
}
bun run build
bun run verify:dist
bun run verify:global
```

Expected: every command succeeds; Bun tests have zero failures and exactly two Windows platform skips; `dist` and global verification report success.

- [ ] **Step 3: Audit first-party runtime entrypoints without banning compatibility APIs**

Run:

```powershell
rg -n -i "\b(node|npm)\b" package.json .github/workflows/ci.yml .gitlab-ci.yml README.md src/main.ts
rg -n 'from "node:test"|require\("node:test"\)' tests
rg -n "#!/usr/bin/env" src/main.ts dist/src/main.js
```

Expected:

- no Node/npm execution command remains;
- no `node:test` import remains;
- both source and compiled entrypoints use `#!/usr/bin/env bun`.

Manually exclude explanatory migration wording, `@types/node`, `node:*` imports, dependency metadata, GitHub Action host internals, and shell-policy fixture data from the fallback judgment.

- [ ] **Step 4: Check diffs and preserve user-owned changes**

Run:

```powershell
git diff --check
git status --short
git diff -- src/ui/commands.ts tests/ui/commands.test.ts
```

Expected: no whitespace errors; the `/models` dead registration remains removed; its regression test remains present with only the intentional `bun:test` import change added during migration.

- [ ] **Step 5: Report local versus remote evidence precisely**

Completion report must distinguish:

- locally executed Windows verification from Task 8;
- configured but not locally executed Ubuntu/macOS GitHub matrix jobs;
- any remote CI results only if an actual run was observed.

Do not claim the migration complete if any canonical local command fails, a permanent Node/npm execution path remains, or documentation contradicts Accepted ADR 0003.
