import type { TuiState } from "../tui-state.js";

export function TuiFooter({
  session,
  run,
}: {
  readonly session: TuiState["session"];
  readonly run: TuiState["run"];
}) {
  return (
    <box height={1} paddingX={2} width="100%" flexDirection="row">
      <text fg="#71717a" width="60%" truncate>
        {session.cwd ?? "cwd unavailable"} · {session.title} [{session.id}]
      </text>
      <text width="40%" truncate>
        <span fg="#a1a1aa">
          {session.model.provider}/{session.model.model}
        </span>
        <span fg="#71717a"> · {run.status} · /help</span>
      </text>
    </box>
  );
}
