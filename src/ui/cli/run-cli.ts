import { createInterface, type Interface } from "node:readline/promises";

import type { AgentHarness } from "../../core/harness/index.js";
import { ApplicationRuntime } from "../../coding-agent/index.js";
import { parseInput } from "../commands.js";
import { CliInteractions } from "./cli-interactions.js";
import { Renderer } from "./renderer.js";

export interface RunCliOptions {
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly color?: boolean;
  readonly reportError: (error: unknown) => void;
  readonly readline?: Interface;
  readonly input?: NodeJS.ReadStream;
  readonly write?: (text: string) => void;
  readonly log?: (text: string) => void;
}

const PROMPT = "kea> ";
const MODEL_REQUIRED = "current model is not configured; use /model before prompting";

/**
 * Run one complete linear CLI lifetime and clean every terminal resource it creates.
 * ApplicationRuntime remains owned by the caller.
 */
export async function runCli(
  runtime: ApplicationRuntime,
  options: RunCliOptions,
): Promise<void> {
  const readline = options.readline ?? createInterface({
    input: options.input ?? process.stdin,
    output: process.stdout,
  });
  let unsubscribe = (): void => {};
  const onSigint = (): void => {
    const current = runtime.current;
    if (current.isRunning) current.abort();
  };

  try {
    const renderer = new Renderer({
      thinking: options.thinking,
      toolDetails: options.toolDetails,
      ...(options.color === undefined ? {} : { color: options.color }),
      write: options.write ?? ((text: string) => process.stdout.write(text)),
      log: options.log ?? ((text: string) => console.log(text)),
    });
    const interactions = new CliInteractions({
      question: (prompt, questionOptions) =>
        questionOptions === undefined
          ? readline.question(prompt)
          : readline.question(prompt, questionOptions),
      log: options.log ?? ((text: string) => console.log(text)),
    });

    const readPrompt = async (prompt = PROMPT): Promise<string | undefined> => {
      try {
        return await readline.question(prompt);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return undefined;
        throw error;
      }
    };

    const chooseIndex = async (
      prompt: string,
      count: number,
    ): Promise<number | undefined> => {
      const answer = await readPrompt(prompt);
      if (answer === undefined) return undefined;
      const trimmed = answer.trim();
      if (!/^\d+$/u.test(trimmed)) return undefined;
      const index = Number.parseInt(trimmed, 10);
      return index >= 1 && index <= count ? index : undefined;
    };

    const ensureConfiguredModel = async (candidate: AgentHarness): Promise<boolean> => {
      const project = runtime.project;
      if (await project.isConfiguredModel(candidate.model)) return true;
      const models = await project.modelOptions();
      renderer.renderError(
        `model ${candidate.model.provider}/${candidate.model.model} is not configured`,
      );
      renderer.renderSelection(
        "Choose a configured model:",
        models.map((model) => `${model.provider}/${model.model}`),
      );
      const index = await chooseIndex("Model number? ", models.length);
      if (index === undefined) return false;
      try {
        await project.switchModel(candidate, models[index - 1]!);
        return true;
      } catch (error) {
        options.reportError(error);
        return false;
      }
    };

    const repairModelAndRender = async (harness: AgentHarness): Promise<void> => {
      const configured = await ensureConfiguredModel(harness);
      renderer.renderSession(harness);
      if (!configured) renderer.renderError(MODEL_REQUIRED);
    };

    const chooseAndSwitchSession = async (): Promise<void> => {
      const sessions = await runtime.project.listSessions();
      if (sessions.length === 0) {
        renderer.renderError("no sessions yet");
        return;
      }
      renderer.renderSelection(
        "Sessions (newest first):",
        sessions.map((metadata) => `${metadata.title} — ${metadata.updatedAt}`),
      );
      const index = await chooseIndex("Session number? ", sessions.length);
      if (index === undefined) return;
      await repairModelAndRender(await runtime.switchSession(sessions[index - 1]!.id));
    };

    const chooseAndSwitchModel = async (): Promise<void> => {
      const models = await runtime.project.modelOptions();
      const providers = [...new Set(models.map((model) => model.provider))];
      renderer.renderSelection("Providers:", providers);
      const providerIndex = await chooseIndex("Provider number? ", providers.length);
      if (providerIndex === undefined) return;
      const provider = providers[providerIndex - 1]!;
      const providerModels = models.filter((model) => model.provider === provider);
      renderer.renderSelection(
        `Models for ${provider}:`,
        providerModels.map((model) => model.model),
      );
      const modelIndex = await chooseIndex("Model number? ", providerModels.length);
      if (modelIndex === undefined) return;
      await runtime.project.switchModel(runtime.current, providerModels[modelIndex - 1]!);
    };

    runtime.bindUserInteraction(interactions);
    process.on("SIGINT", onSigint);
    if (!await ensureConfiguredModel(runtime.current)) return;
    unsubscribe = runtime.subscribe((event) => renderer.handle(event));
    renderer.renderSession(runtime.current);

    while (true) {
      const input = await readPrompt();
      if (input === undefined) return;
      const action = parseInput(input);
      switch (action.kind) {
        case "prompt":
          if (action.text.trim() === "") break;
          if (!await runtime.project.isConfiguredModel(runtime.current.model)) {
            renderer.renderError(MODEL_REQUIRED);
            break;
          }
          try {
            await runtime.current.prompt(action.text);
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "new-session":
          try {
            await repairModelAndRender(await runtime.newSession());
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "switch-session":
          try {
            await chooseAndSwitchSession();
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "switch-model":
          try {
            await chooseAndSwitchModel();
          } catch (error) {
            options.reportError(error);
          }
          break;
        case "help":
          renderer.renderHelp();
          break;
        case "exit":
          return;
        case "command-error":
          renderer.renderError(action.message);
          break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    try {
      unsubscribe();
    } finally {
      readline.close();
    }
  }
}
