import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

function executableTokens(command: string): string[] {
  return [...command.matchAll(
    /(?:^|[\s;&|()"'`])(?<tool>node|npm|npx)(?:\.exe)?(?=$|[\s;&|()"'`])/giu,
  )].flatMap((match) => match.groups?.["tool"]?.toLowerCase() ?? []);
}

function packageScriptFallbacks(scripts: Readonly<Record<string, string>>): string[] {
  return Object.entries(scripts).flatMap(([name, command]) =>
    executableTokens(command).map((tool) => `${name}:${tool}`)
  );
}

function githubRunCommands(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/u);
  const commands: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const run = /^(?<indent>\s*)run:\s*(?<value>.*)$/u.exec(line);
    if (run === null) continue;
    const value = run.groups?.["value"] ?? "";
    if (!/^[|>][-+]?$/u.test(value)) {
      commands.push(value);
      continue;
    }
    const indent = (run.groups?.["indent"] ?? "").length;
    for (index += 1; index < lines.length; index += 1) {
      const blockLine = lines[index]!;
      if (blockLine.trim() === "") continue;
      const blockIndent = /^\s*/u.exec(blockLine)?.[0].length ?? 0;
      if (blockIndent <= indent) {
        index -= 1;
        break;
      }
      commands.push(blockLine.trim());
    }
  }
  return commands;
}

function githubFallbacks(workflow: string): string[] {
  const violations: string[] = [];
  if (/\bsetup-node(?:@|\b)/iu.test(workflow)) violations.push("setup-node");
  if (/^\s*node-version\s*:/imu.test(workflow)) violations.push("node-version");
  if (/^\s*cache\s*:\s*["']?npm["']?\s*$/imu.test(workflow)) {
    violations.push("npm-cache");
  }
  for (const command of githubRunCommands(workflow)) {
    violations.push(...executableTokens(command).map((tool) => `run:${tool}`));
  }
  return violations;
}

function gitlabFallbacks(workflow: string): string[] {
  const violations: string[] = [];
  if (/^\s*image\s*:\s*["']?node(?:[:@/-]|["']?\s*$)/imu.test(workflow)) {
    violations.push("node-image");
  }
  if (/\bnode_modules[\\/]/iu.test(workflow)) violations.push("node-modules-cache");
  if (/(?:^|\s)\.npm[\\/]/imu.test(workflow)) violations.push("npm-cache");
  if (/\bpackage-lock\.json\b/iu.test(workflow)) violations.push("npm-lock-cache");
  for (const line of workflow.split(/\r?\n/u)) {
    const command = /^\s*-\s*(?<value>.*)$/u.exec(line)?.groups?.["value"];
    if (command === undefined) continue;
    violations.push(...executableTokens(command).map((tool) => `command:${tool}`));
  }
  return violations;
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

test("OpenTUI React dependencies and TSX compilation are pinned", async () => {
  const pkg = JSON.parse(await text("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  expect(pkg.dependencies?.["@opentui/core"]).toBe("0.5.8");
  expect(pkg.dependencies?.["@opentui/react"]).toBe("0.5.8");
  expect(pkg.dependencies?.["react"]).toBe("19.2.8");
  expect(pkg.devDependencies?.["@types/react"]).toBe("19.2.18");
  expect(pkg.dependencies?.["react-dom"]).toBeUndefined();
  expect(pkg.dependencies?.["react-devtools-core"]).toBeUndefined();
  expect(pkg.dependencies?.["ws"]).toBeUndefined();

  const base = JSON.parse(await text("tsconfig.json")) as {
    compilerOptions?: Record<string, unknown>;
    include?: string[];
  };
  const build = JSON.parse(await text("tsconfig.build.json")) as {
    include?: string[];
  };
  expect(base.compilerOptions?.["jsx"]).toBe("react-jsx");
  expect(base.compilerOptions?.["jsxImportSource"]).toBe("@opentui/react");
  expect(base.include).toContain("src/**/*.tsx");
  expect(base.include).toContain("tests/**/*.tsx");
  expect(build.include).toContain("src/**/*.tsx");
});

test("Bun discovers only root source tests", async () => {
  const bunfig = (await text("bunfig.toml")).replaceAll("\r\n", "\n");
  expect(bunfig).toBe('[test]\nroot = "tests"\n');
});

test("the production entrypoint selects Bun", async () => {
  expect(await text("src/main.ts")).toMatch(/^#!\/usr\/bin\/env bun\r?\n/u);
});

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
  expect(github).not.toContain("macos-latest");
  expect(github).toContain("uses: oven-sh/setup-bun@v2");
  expect(github).toContain("bun-version: 1.3.7");
  expect(github).not.toContain("setup-node");
  expect(gitlab).toContain("image: oven/bun:1.3.7");
  expect(gitlab).toContain("apt-get install -y -qq --no-install-recommends git");
  expect(gitlab).not.toMatch(/\bnpm\b/u);
  expect(gitlab).not.toContain("node:24");
});

test("first-party execution surfaces reject Node and npm fallbacks", async () => {
  const pkg = JSON.parse(await text("package.json")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const github = await text(".github/workflows/ci.yml");
  const gitlab = await text(".gitlab-ci.yml");

  expect(packageScriptFallbacks(pkg.scripts ?? {})).toEqual([]);
  expect(githubFallbacks(github)).toEqual([]);
  expect(gitlabFallbacks(gitlab)).toEqual([]);
  expect(executableTokens("@types/node node:fs node:path")).toEqual([]);

  expect(packageScriptFallbacks({
    compatible: "bun -e 'await import(\"node:fs\")'",
    node: "node dist/src/main.js",
    npm: "bun run clean && npm test",
    npx: "npx tsc --noEmit",
  })).toEqual(["node:node", "npm:npm", "npx:npx"]);
  expect(githubFallbacks(`
uses: actions/setup-node@v4
with:
  node-version: 24
  cache: npm
run: node dist/src/main.js
run: |
  npm test
  npx tsc --noEmit
`)).toEqual([
    "setup-node",
    "node-version",
    "npm-cache",
    "run:node",
    "run:npm",
    "run:npx",
  ]);
  expect(gitlabFallbacks(`
image: node:24
cache:
  paths:
    - node_modules/
    - .npm/
    - package-lock.json
script:
  - node dist/src/main.js
  - npm test
  - npx tsc --noEmit
`)).toEqual([
    "node-image",
    "node-modules-cache",
    "npm-cache",
    "npm-lock-cache",
    "command:node",
    "command:npm",
    "command:npx",
  ]);
});
