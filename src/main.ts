#!/usr/bin/env bun
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs } from "./coding-agent/cli/args.js";
import { resolveProjectDirectory } from "./coding-agent/cli/project-directory.js";
import { loadConfig } from "./coding-agent/config/config.js";
import { createApplicationRuntime } from "./coding-agent/index.js";

/** Production composition root; never runs on import. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.diagnostics.some((d) => d.type === "error")) {
    for (const d of args.diagnostics) {
      console.error(`${d.type}: ${d.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (args.ui === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error("error: TUI requires interactive stdin and stdout; use --ui cli");
    process.exitCode = 1;
    return;
  }

  const projectDirectory = await resolveProjectDirectory(args.directory);
  const { config, keaHome } = await loadConfig({
    projectDirectory,
    ...(args.config === undefined ? {} : { configOverride: args.config }),
    verbose: args.verbose,
  });

  const reportError = (error: unknown): void => {
    console.error(config.redact(error instanceof Error ? error.message : String(error)));
  };

  if (config.verbose) {
    reportError(`project directory: ${projectDirectory}`);
    for (const model of config.models) {
      reportError(`model: ${model.provider}/${model.model}`);
    }
    for (const provider of config.runtimeProviders()) {
      reportError(
        `credentials: ${provider.name} ${provider.apiKey === "" ? "missing" : "configured"}`,
      );
    }
  }

  const applicationRuntime = await createApplicationRuntime({
    keaHome,
    projectDirectory,
    providers: config.runtimeProviders(),
    modelConfig: config.defaultModel,
    models: config.models,
    continueSession: args.continue,
    maxTurns: config.maxTurns,
    toolTimeoutSeconds: config.toolTimeoutSeconds,
  });
  try {
    if (args.ui === "cli") {
      const { runCli } = await import("./ui/cli/index.js");
      await runCli(applicationRuntime, {
        thinking: config.thinking,
        toolDetails: config.toolDetails,
        reportError,
      });
    } else {
      const { runTui } = await import("./ui/tui/run-tui.js");
      await runTui(applicationRuntime, {
        thinking: config.thinking,
        toolDetails: config.toolDetails,
        redact: (message) => config.redact(message),
      });
    }
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  } finally {
    applicationRuntime.close();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
