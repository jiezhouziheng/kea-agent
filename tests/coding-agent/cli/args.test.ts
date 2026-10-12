import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "bun:test";

import { parseArgs } from "../../../src/coding-agent/cli/args.js";

test("UI defaults to TUI after the parity gate", () => {
  assert.deepEqual(parseArgs([]), {
    continue: false,
    ui: "tui",
    verbose: false,
    directory: process.cwd(),
    diagnostics: [],
  });
});

test("run arguments parse continue, override, UI, verbose, and directory", () => {
  assert.deepEqual(
    parseArgs(["-c", "--config", "custom.json", "--ui", "tui", "--verbose", "work"]),
    {
      continue: true,
      config: resolve("custom.json"),
      ui: "tui",
      verbose: true,
      directory: resolve("work"),
      diagnostics: [],
    },
  );
});

test("a single positional directory resolves against the cwd", () => {
  assert.deepEqual(parseArgs(["work"]), {
    continue: false,
    ui: "tui",
    verbose: false,
    directory: resolve("work"),
    diagnostics: [],
  });
});

test("UI accepts only separate tui and cli values", () => {
  assert.equal(parseArgs(["--ui", "tui"]).ui, "tui");
  assert.equal(parseArgs(["--ui", "cli"]).ui, "cli");

  for (const argv of [["--ui"], ["--ui", "other"], ["--ui=tui"]]) {
    assert.ok(
      parseArgs(argv).diagnostics.some((diagnostic) => diagnostic.type === "error"),
      `expected an error for ${JSON.stringify(argv)}`,
    );
  }
});

test("unknown options and a missing option value become errors", () => {
  const unknown = parseArgs(["--unknown"]);
  assert.ok(
    unknown.diagnostics.some(
      (d) => d.type === "error" && d.message.includes("Unknown option: --unknown"),
    ),
  );

  const missing = parseArgs(["--config"]);
  assert.ok(
    missing.diagnostics.some(
      (d) => d.type === "error" && /missing.*--config/i.test(d.message),
    ),
  );
});

test("duplicate single-value options become errors", () => {
  const dupConfig = parseArgs(["--config", "a.json", "--config", "b.json"]);
  assert.ok(
    dupConfig.diagnostics.some(
      (d) => d.type === "error" && /duplicate.*--config/i.test(d.message),
    ),
  );

  const dupC = parseArgs(["-c", "-c"]);
  assert.ok(
    dupC.diagnostics.some(
      (d) => d.type === "error" && /duplicate.*-c/i.test(d.message),
    ),
  );

  const dupVerbose = parseArgs(["--verbose", "--verbose"]);
  assert.ok(
    dupVerbose.diagnostics.some(
      (d) => d.type === "error" && /duplicate.*--verbose/i.test(d.message),
    ),
  );

  const dupUi = parseArgs(["--ui", "cli", "--ui", "tui"]);
  assert.ok(
    dupUi.diagnostics.some(
      (d) => d.type === "error" && /duplicate.*--ui/i.test(d.message),
    ),
  );
});

test("multiple directories become an error", () => {
  const args = parseArgs(["a", "b"]);
  assert.ok(
    args.diagnostics.some(
      (d) => d.type === "error" && /multiple directories/i.test(d.message),
    ),
  );
});
