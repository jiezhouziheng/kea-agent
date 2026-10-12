import {
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";

import type { ApplicationRuntime } from "../../coding-agent/index.js";
import { TuiApp } from "./tui-app.js";

const EXIT_SIGNALS: NodeJS.Signals[] = [
  "SIGTERM",
  "SIGQUIT",
  "SIGABRT",
  "SIGHUP",
  "SIGPIPE",
  "SIGBREAK",
  "SIGBUS",
];

/** Run one complete alternate-screen TUI lifetime and restore the terminal before returning. */
export async function runTui(
  runtime: ApplicationRuntime,
  options: {
    readonly thinking: "hidden" | "visible";
    readonly toolDetails: "compact" | "full";
    readonly redact: (message: string) => string;
  },
): Promise<void> {
  let renderer: CliRenderer | undefined;
  let rendererDestroyed: Promise<void> | undefined;
  let root: Root | undefined;
  let activePrompt: Promise<void> | undefined;
  let exiting = false;
  let resolveExit!: () => void;
  const exitRequested = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const requestExit = (): void => {
    if (exiting) return;
    exiting = true;
    if (runtime.current.isRunning) runtime.current.abort();
    resolveExit();
  };
  const onSigint = (): void => requestExit();

  process.on("SIGINT", onSigint);
  try {
    renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      exitOnCtrlC: false,
      exitSignals: EXIT_SIGNALS,
      consoleMode: "disabled",
      onDestroy: requestExit,
    });
    const createdRenderer = renderer;
    rendererDestroyed = createdRenderer.isDestroyed
      ? Promise.resolve()
      : new Promise<void>((resolve) => createdRenderer.once("destroy", resolve));
    if (!renderer.isDestroyed) {
      root = createRoot(renderer);
      root.render(
        <TuiApp
          runtime={runtime}
          thinking={options.thinking}
          toolDetails={options.toolDetails}
          redact={options.redact}
          onExit={requestExit}
          trackPrompt={(task) => {
            activePrompt = task;
          }}
        />,
      );
    }
    await exitRequested;
  } finally {
    exiting = true;
    const prompt = activePrompt;
    if (runtime.current.isRunning) runtime.current.abort();
    root?.unmount();
    if (renderer !== undefined && !renderer.isDestroyed) renderer.destroy();
    await rendererDestroyed;
    process.removeListener("SIGINT", onSigint);
    await prompt?.catch(() => {});
  }
}
