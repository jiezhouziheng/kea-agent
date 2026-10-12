import type { ModelConfig } from "../../core/ai/index.js";
import type {
  AgentMessage,
  AgentToolCall,
  AgentToolResult,
  HarnessEvent,
  SessionMetadata,
} from "../../core/harness/index.js";
import type { TuiInteractionRequest } from "./tui-interactions.js";

export interface TuiSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly model: ModelConfig;
  readonly cwd: string | undefined;
  readonly history: readonly AgentMessage[];
}

export type TuiLiveBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly thinking: string }
  | {
      readonly kind: "tool";
      readonly runId: string;
      readonly id: string;
      readonly name: string | undefined;
      readonly argumentsText: string;
      readonly call: AgentToolCall | undefined;
      readonly result: AgentToolResult | undefined;
    };

export type TuiRunState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly runId: string; readonly sawTurnStart: boolean }
  | { readonly status: "completed" | "aborted"; readonly runId: string }
  | { readonly status: "error"; readonly runId: string; readonly message: string };

export type TuiPanel =
  | { readonly kind: "composer" }
  | { readonly kind: "help" }
  | {
      readonly kind: "sessions";
      readonly sessions: readonly SessionMetadata[];
      readonly selectedIndex: number;
    }
  | {
      readonly kind: "providers";
      readonly providers: readonly string[];
      readonly selectedIndex: number;
    }
  | {
      readonly kind: "models";
      readonly reason: "command" | "initial-repair" | "session-repair";
      readonly models: readonly ModelConfig[];
      readonly selectedIndex: number;
    }
  | {
      readonly kind: "interaction";
      readonly request: TuiInteractionRequest;
      readonly selectedIndex: number;
      readonly input: string;
    };

export interface TuiState {
  readonly session: Omit<TuiSessionSnapshot, "history">;
  readonly history: readonly AgentMessage[];
  readonly composer: string;
  readonly pendingUser: string | undefined;
  readonly liveTurn: readonly TuiLiveBlock[];
  readonly run: TuiRunState;
  readonly panel: TuiPanel;
  readonly commandMenu: {
    readonly selectedIndex: number;
    readonly dismissed: boolean;
  };
  readonly notice: string | undefined;
}

export type TuiStreamEvent = Exclude<
  HarnessEvent,
  | { readonly type: "run-start" }
  | { readonly type: "run-end" }
  | { readonly type: "turn-start" }
  | { readonly type: "turn-end" }
>;

export type TuiAction =
  | { readonly type: "session-replaced"; readonly snapshot: TuiSessionSnapshot }
  | { readonly type: "prompt-submitted"; readonly text: string }
  | { readonly type: "run-started"; readonly runId: string }
  | {
      readonly type: "turn-started";
      readonly runId: string;
      readonly committed: Pick<TuiSessionSnapshot, "history" | "title" | "model"> | undefined;
    }
  | { readonly type: "stream-event"; readonly event: TuiStreamEvent }
  | {
      readonly type: "turn-ended";
      readonly runId: string;
      readonly message: AgentMessage;
      readonly toolResults: readonly AgentMessage[];
    }
  | {
      readonly type: "run-ended";
      readonly runId: string;
      readonly reason: "completed" | "aborted" | "error";
      readonly errorMessage: string | undefined;
      readonly committed: Pick<TuiSessionSnapshot, "history" | "title" | "model"> | undefined;
    }
  | { readonly type: "composer-changed"; readonly value: string }
  | { readonly type: "command-selection-changed"; readonly selectedIndex: number }
  | { readonly type: "command-menu-dismissed" }
  | {
      readonly type: "panel-opened";
      readonly panel: Exclude<TuiPanel, { readonly kind: "composer" }>;
    }
  | { readonly type: "panel-moved"; readonly delta: number }
  | { readonly type: "panel-input-changed"; readonly value: string }
  | { readonly type: "panel-closed" }
  | {
      readonly type: "interaction-changed";
      readonly request: TuiInteractionRequest | undefined;
    }
  | { readonly type: "notice-changed"; readonly message: string | undefined };

export function createTuiState(snapshot: TuiSessionSnapshot): TuiState {
  return {
    session: {
      id: snapshot.id,
      title: snapshot.title,
      model: snapshot.model,
      cwd: snapshot.cwd,
    },
    history: snapshot.history,
    composer: "",
    pendingUser: undefined,
    liveTurn: [],
    run: { status: "idle" },
    panel: { kind: "composer" },
    commandMenu: { selectedIndex: 0, dismissed: false },
    notice: undefined,
  };
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "session-replaced":
      return createTuiState(action.snapshot);
    case "prompt-submitted":
      return { ...state, composer: "", pendingUser: action.text };
    case "run-started":
      return {
        ...state,
        liveTurn: [],
        run: { status: "running", runId: action.runId, sawTurnStart: false },
      };
    case "turn-started": {
      if (!isCurrentRun(state, action.runId)) return state;
      const firstTurn = !state.run.sawTurnStart;
      if (firstTurn && action.committed !== undefined) {
        return {
          ...state,
          session: {
            ...state.session,
            title: action.committed.title,
            model: action.committed.model,
          },
          history: action.committed.history,
          pendingUser: undefined,
          liveTurn: [],
          run: { ...state.run, sawTurnStart: true },
        };
      }
      return {
        ...state,
        liveTurn: [],
        run: { ...state.run, sawTurnStart: true },
      };
    }
    case "stream-event":
      if (!isCurrentRun(state, action.event.runId)) return state;
      return projectStreamEvent(state, action.event);
    case "turn-ended":
      if (!isCurrentRun(state, action.runId)) return state;
      return {
        ...state,
        history: [...state.history, action.message, ...action.toolResults],
        liveTurn: [],
      };
    case "run-ended": {
      if (!isCurrentRun(state, action.runId)) return state;
      const committed = state.run.sawTurnStart ? undefined : action.committed;
      const next = committed === undefined
        ? state
        : {
            ...state,
            session: {
              ...state.session,
              title: committed.title,
              model: committed.model,
            },
            history: committed.history,
          };
      const run: TuiRunState = action.reason === "error"
        ? {
            status: "error",
            runId: action.runId,
            message: action.errorMessage ?? "Run failed",
          }
        : { status: action.reason, runId: action.runId };
      return { ...next, pendingUser: undefined, liveTurn: [], run };
    }
    case "composer-changed":
      return {
        ...state,
        composer: action.value,
        commandMenu: { selectedIndex: 0, dismissed: false },
      };
    case "command-selection-changed":
      return {
        ...state,
        commandMenu: { ...state.commandMenu, selectedIndex: action.selectedIndex },
      };
    case "command-menu-dismissed":
      return { ...state, commandMenu: { ...state.commandMenu, dismissed: true } };
    case "panel-opened":
      return { ...state, panel: action.panel };
    case "panel-moved":
      return movePanel(state, action.delta);
    case "panel-input-changed":
      return state.panel.kind === "interaction" && state.panel.request.kind === "input"
        ? { ...state, panel: { ...state.panel, input: action.value } }
        : state;
    case "panel-closed":
      return { ...state, panel: { kind: "composer" } };
    case "interaction-changed":
      if (action.request !== undefined) {
        return {
          ...state,
          panel: {
            kind: "interaction",
            request: action.request,
            selectedIndex: 0,
            input: "",
          },
        };
      }
      return state.panel.kind === "interaction"
        ? { ...state, panel: { kind: "composer" } }
        : state;
    case "notice-changed":
      return { ...state, notice: action.message };
  }
}

function isCurrentRun(
  state: TuiState,
  runId: string,
): state is TuiState & {
  readonly run: Extract<TuiRunState, { readonly status: "running" }>;
} {
  return state.run.status === "running" && state.run.runId === runId;
}

function projectStreamEvent(state: TuiState, event: TuiStreamEvent): TuiState {
  switch (event.type) {
    case "text-start":
      return { ...state, liveTurn: [...state.liveTurn, { kind: "text", text: "" }] };
    case "thinking-start":
      return {
        ...state,
        liveTurn: [...state.liveTurn, { kind: "thinking", thinking: "" }],
      };
    case "text-delta":
      return { ...state, liveTurn: appendText(state.liveTurn, event.text) };
    case "thinking-delta":
      return { ...state, liveTurn: appendThinking(state.liveTurn, event.thinking) };
    case "text-end":
    case "thinking-end":
      return state;
    case "tool-call-start":
      return {
        ...state,
        liveTurn: updateTool(state.liveTurn, event.runId, event.id, (block) => ({
          ...block,
          name: event.name,
        })),
      };
    case "tool-call-delta":
      return {
        ...state,
        liveTurn: updateTool(state.liveTurn, event.runId, event.id, (block) => ({
          ...block,
          argumentsText: block.argumentsText + event.argumentsDelta,
        })),
      };
    case "tool-call":
      return {
        ...state,
        liveTurn: updateTool(state.liveTurn, event.runId, event.call.id, (block) => ({
          ...block,
          name: event.call.name,
          argumentsText: block.argumentsText || JSON.stringify(event.call.arguments),
          call: event.call,
        })),
      };
    case "tool-result":
      return {
        ...state,
        liveTurn: updateTool(state.liveTurn, event.runId, event.call.id, (block) => ({
          ...block,
          name: event.call.name,
          argumentsText: block.argumentsText || JSON.stringify(event.call.arguments),
          call: event.call,
          result: event.result,
        })),
      };
  }
}

function appendText(blocks: readonly TuiLiveBlock[], text: string): readonly TuiLiveBlock[] {
  const last = blocks.at(-1);
  if (last?.kind !== "text") return [...blocks, { kind: "text", text }];
  return [...blocks.slice(0, -1), { kind: "text", text: last.text + text }];
}

function appendThinking(
  blocks: readonly TuiLiveBlock[],
  thinking: string,
): readonly TuiLiveBlock[] {
  const last = blocks.at(-1);
  if (last?.kind !== "thinking") return [...blocks, { kind: "thinking", thinking }];
  return [
    ...blocks.slice(0, -1),
    { kind: "thinking", thinking: last.thinking + thinking },
  ];
}

function updateTool(
  blocks: readonly TuiLiveBlock[],
  runId: string,
  id: string,
  update: (block: Extract<TuiLiveBlock, { readonly kind: "tool" }>) => TuiLiveBlock,
): readonly TuiLiveBlock[] {
  const index = blocks.findIndex(
    (block) => block.kind === "tool" && block.runId === runId && block.id === id,
  );
  const block: Extract<TuiLiveBlock, { readonly kind: "tool" }> = index === -1
    ? {
        kind: "tool",
        runId,
        id,
        name: undefined,
        argumentsText: "",
        call: undefined,
        result: undefined,
      }
    : blocks[index] as Extract<TuiLiveBlock, { readonly kind: "tool" }>;
  const next = update(block);
  if (index === -1) return [...blocks, next];
  return blocks.map((current, currentIndex) => currentIndex === index ? next : current);
}

function movePanel(state: TuiState, delta: number): TuiState {
  const panel = state.panel;
  let length: number;
  switch (panel.kind) {
    case "sessions":
      length = panel.sessions.length;
      break;
    case "providers":
      length = panel.providers.length;
      break;
    case "models":
      length = panel.models.length;
      break;
    case "interaction":
      length = panel.request.kind === "select"
        ? panel.request.options.length
        : panel.request.kind === "confirm" ? 2 : 1;
      break;
    case "composer":
    case "help":
      return state;
  }
  const selectedIndex = Math.max(0, Math.min(length - 1, panel.selectedIndex + delta));
  if (selectedIndex === panel.selectedIndex) return state;
  return { ...state, panel: { ...panel, selectedIndex } };
}
