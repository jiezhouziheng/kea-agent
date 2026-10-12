import { SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ApplicationRuntime } from "../../coding-agent/index.js";
import { parseInput, UI_COMMANDS } from "../commands.js";
import { BottomPanel } from "./components/bottom-panel.js";
import { Transcript } from "./components/transcript.js";
import { TuiFooter } from "./components/tui-footer.js";
import { WelcomeScreen } from "./components/welcome-screen.js";
import { TuiInteractions } from "./tui-interactions.js";
import {
  createTuiState,
  tuiReducer,
  type TuiSessionSnapshot,
} from "./tui-state.js";

const MODEL_REQUIRED = "current model is not configured; use /model before prompting";

export interface TuiAppProps {
  readonly runtime: ApplicationRuntime;
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly redact: (message: string) => string;
  readonly onExit: () => void;
  readonly trackPrompt: (task: Promise<void> | undefined) => void;
}

async function readSessionSnapshot(
  runtime: ApplicationRuntime,
): Promise<TuiSessionSnapshot> {
  const harness = runtime.current;
  const metadata = (await runtime.project.listSessions())
    .find((candidate) => candidate.id === harness.sessionId);
  return {
    id: harness.sessionId,
    title: harness.title,
    model: harness.model,
    cwd: metadata?.cwd,
    history: harness.messages,
  };
}

export function TuiApp({
  runtime,
  thinking,
  toolDetails,
  redact,
  onExit,
  trackPrompt,
}: TuiAppProps) {
  const [state, dispatch] = useReducer(
    tuiReducer,
    {
      id: runtime.current.sessionId,
      title: runtime.current.title,
      model: runtime.current.model,
      cwd: undefined,
      history: runtime.current.messages,
    },
    createTuiState,
  );
  const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles({
    default: { fg: "#d4d4d8" },
    heading: { fg: "#60a5fa", bold: true },
    strong: { bold: true },
    code: { fg: "#fbbf24" },
  }), []);
  const composer = useRef<TextareaRenderable>(null);
  const panelInput = useRef<TextareaRenderable>(null);
  const runStarted = useRef(false);
  const [modelReady, setModelReady] = useState(false);
  const interactions = useMemo(() => new TuiInteractions({
    show: (request) => dispatch({ type: "interaction-changed", request }),
  }), []);
  const panel = state.panel;
  const commandSuggestions = panel.kind === "composer"
      && state.run.status !== "running"
      && !state.commandMenu.dismissed
      && /^\/\S*$/u.test(state.composer)
    ? UI_COMMANDS.filter((command) => command.token.startsWith(state.composer))
    : [];
  const emptySession = state.history.length === 0
    && state.pendingUser === undefined
    && state.liveTurn.length === 0;

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    let sawTurnStart = false;
    const unsubscribe = runtime.subscribe((event) => {
      receivedEvent = true;
      switch (event.type) {
        case "run-start":
          runStarted.current = true;
          sawTurnStart = false;
          dispatch({ type: "run-started", runId: event.runId });
          break;
        case "turn-start": {
          const harness = runtime.current;
          dispatch({
            type: "turn-started",
            runId: event.runId,
            committed: sawTurnStart
              ? undefined
              : {
                  history: harness.messages,
                  title: harness.title,
                  model: harness.model,
                },
          });
          sawTurnStart = true;
          break;
        }
        case "turn-end":
          dispatch({
            type: "turn-ended",
            runId: event.runId,
            message: event.message,
            toolResults: event.toolResults,
          });
          break;
        case "run-end": {
          const harness = runtime.current;
          dispatch({
            type: "run-ended",
            runId: event.runId,
            reason: event.reason,
            errorMessage: event.reason === "error" ? redact(event.errorMessage) : undefined,
            committed: sawTurnStart
              ? undefined
              : {
                  history: harness.messages,
                  title: harness.title,
                  model: harness.model,
                },
          });
          break;
        }
        default:
          dispatch({ type: "stream-event", event });
      }
    });

    void readSessionSnapshot(runtime).then((snapshot) => {
      if (!active) return;
      if (!receivedEvent && runtime.current.sessionId === snapshot.id) {
        dispatch({ type: "session-replaced", snapshot });
      }
      const configured = runtime.project.isConfiguredModel(runtime.current.model);
      setModelReady(configured);
      if (!configured) {
        dispatch({
          type: "notice-changed",
          message: `model ${runtime.current.model.provider}/${runtime.current.model.model} is not configured`,
        });
        dispatch({
          type: "panel-opened",
          panel: {
            kind: "models",
            reason: "initial-repair",
            models: runtime.project.modelOptions(),
            selectedIndex: 0,
          },
        });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "notice-changed", message: redact(message) });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [redact, runtime]);

  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  useEffect(() => {
    runtime.bindUserInteraction(interactions);
    return () => interactions.close();
  }, [interactions, runtime]);

  const showError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    dispatch({ type: "notice-changed", message: redact(message) });
  };

  const clearComposer = (): void => {
    composer.current?.setText("");
    dispatch({ type: "composer-changed", value: "" });
  };

  const repairCurrentModel = (
    reason: "initial-repair" | "session-repair",
  ): void => {
    const configured = runtime.project.isConfiguredModel(runtime.current.model);
    setModelReady(configured);
    if (configured) {
      dispatch({ type: "panel-closed" });
      return;
    }
    const models = runtime.project.modelOptions();
    dispatch({ type: "notice-changed", message: MODEL_REQUIRED });
    dispatch({
      type: "panel-opened",
      panel: { kind: "models", reason, models, selectedIndex: 0 },
    });
  };

  const replaceSessionSnapshot = async (): Promise<void> => {
    dispatch({ type: "session-replaced", snapshot: await readSessionSnapshot(runtime) });
  };

  const submitPrompt = (text: string): void => {
    if (!modelReady) {
      dispatch({ type: "notice-changed", message: MODEL_REQUIRED });
      return;
    }
    dispatch({ type: "prompt-submitted", text });
    runStarted.current = false;
    let task: Promise<void>;
    try {
      task = runtime.current.prompt(text);
    } catch (error) {
      showError(error);
      return;
    }
    trackPrompt(task);
    void task.catch((error: unknown) => {
      if (!runStarted.current) showError(error);
    }).finally(() => trackPrompt(undefined));
  };

  const submitComposer = (): void => {
    if (state.panel.kind !== "composer" || state.run.status === "running") return;
    const input = composer.current?.editBuffer.getText() ?? state.composer;
    if (input.trim() === "") {
      clearComposer();
      return;
    }
    const selectedCommand = commandSuggestions[state.commandMenu.selectedIndex];
    const action = parseInput(selectedCommand?.token ?? input);
    clearComposer();
    switch (action.kind) {
      case "prompt":
        submitPrompt(action.text);
        break;
      case "new-session":
        void (async () => {
          try {
            await runtime.newSession();
            await replaceSessionSnapshot();
            repairCurrentModel("session-repair");
          } catch (error) {
            showError(error);
          }
        })();
        break;
      case "switch-session":
        void (async () => {
          try {
            const sessions = await runtime.project.listSessions();
            if (sessions.length === 0) {
              dispatch({ type: "notice-changed", message: "no sessions yet" });
              return;
            }
            dispatch({
              type: "panel-opened",
              panel: { kind: "sessions", sessions, selectedIndex: 0 },
            });
          } catch (error) {
            showError(error);
          }
        })();
        break;
      case "switch-model":
        try {
          const models = runtime.project.modelOptions();
          const providers = [...new Set(models.map((model) => model.provider))];
          dispatch({
            type: "panel-opened",
            panel: { kind: "providers", providers, selectedIndex: 0 },
          });
        } catch (error) {
          showError(error);
        }
        break;
      case "help":
        dispatch({ type: "panel-opened", panel: { kind: "help" } });
        break;
      case "exit":
        onExit();
        break;
      case "command-error":
        dispatch({ type: "notice-changed", message: action.message });
        break;
    }
  };

  const selectPanelItem = (index: number): void => {
    const panel = state.panel;
    switch (panel.kind) {
      case "sessions": {
        const selected = panel.sessions[index];
        if (selected === undefined) return;
        void (async () => {
          try {
            await runtime.switchSession(selected.id);
            await replaceSessionSnapshot();
            repairCurrentModel("session-repair");
          } catch (error) {
            showError(error);
          }
        })();
        break;
      }
      case "providers": {
        const provider = panel.providers[index];
        if (provider === undefined) return;
        try {
          const models = runtime.project.modelOptions()
            .filter((model) => model.provider === provider);
          dispatch({
            type: "panel-opened",
            panel: { kind: "models", reason: "command", models, selectedIndex: 0 },
          });
        } catch (error) {
          showError(error);
        }
        break;
      }
      case "models": {
        const selected = panel.models[index];
        if (selected === undefined) return;
        void (async () => {
          try {
            await runtime.project.switchModel(runtime.current, selected);
            setModelReady(true);
            await replaceSessionSnapshot();
          } catch (error) {
            showError(error);
          }
        })();
        break;
      }
      case "interaction":
        if (panel.request.kind === "select") interactions.answer(index);
        else if (panel.request.kind === "confirm") interactions.answer(index === 0);
        break;
      case "composer":
      case "help":
        break;
    }
  };

  const cancelPanel = (): void => {
    const panel = state.panel;
    if (panel.kind === "interaction") {
      interactions.cancel();
      return;
    }
    if (panel.kind === "models" && panel.reason === "initial-repair") {
      onExit();
      return;
    }
    if (panel.kind === "models" && panel.reason === "session-repair") {
      setModelReady(false);
      dispatch({ type: "notice-changed", message: MODEL_REQUIRED });
    }
    dispatch({ type: "panel-closed" });
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      onExit();
      return;
    }
    if (commandSuggestions.length > 0 && (key.name === "up" || key.name === "down")) {
      key.preventDefault();
      key.stopPropagation();
      const delta = key.name === "up" ? -1 : 1;
      dispatch({
        type: "command-selection-changed",
        selectedIndex: Math.max(
          0,
          Math.min(
            commandSuggestions.length - 1,
            state.commandMenu.selectedIndex + delta,
          ),
        ),
      });
      return;
    }
    if (key.name === "escape" && commandSuggestions.length > 0) {
      key.preventDefault();
      key.stopPropagation();
      dispatch({ type: "command-menu-dismissed" });
      return;
    }
    if (key.name === "escape" && state.panel.kind !== "composer") {
      key.preventDefault();
      key.stopPropagation();
      cancelPanel();
    }
  });

  const bottomPanel = (
    <BottomPanel
      panel={panel}
      notice={state.notice}
      run={state.run}
      composerValue={state.composer}
      commandSuggestions={commandSuggestions}
      commandSelectedIndex={state.commandMenu.selectedIndex}
      composerRef={composer}
      panelInputRef={panelInput}
      onComposerChanged={(value) => dispatch({ type: "composer-changed", value })}
      onComposerSubmitted={submitComposer}
      onPanelInputChanged={(value) => dispatch({ type: "panel-input-changed", value })}
      onInteractionInputSubmitted={(value) => interactions.answer(value)}
      onPanelMoved={(delta) => dispatch({ type: "panel-moved", delta })}
      onPanelSelected={selectPanelItem}
    />
  );

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#09090b">
      {emptySession ? (
        <WelcomeScreen session={state.session}>{bottomPanel}</WelcomeScreen>
      ) : (
        <>
          <Transcript
            history={state.history}
            pendingUser={state.pendingUser}
            liveTurn={state.liveTurn}
            thinking={thinking}
            toolDetails={toolDetails}
            syntaxStyle={syntaxStyle}
          />
          {bottomPanel}
        </>
      )}
      <TuiFooter session={state.session} run={state.run} />
    </box>
  );
}
