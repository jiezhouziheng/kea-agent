import type { ReactNode } from "react";

import type { TuiState } from "../tui-state.js";

export function WelcomeScreen({
  session,
  children,
}: {
  readonly session: TuiState["session"];
  readonly children: ReactNode;
}) {
  return (
    <box flexGrow={1} width="100%" alignItems="center" justifyContent="center">
      <box width="64%" flexDirection="column">
        <box flexDirection="column" alignItems="center" gap={1} paddingBottom={1}>
          <ascii-font
            text="KEA"
            font="block"
            color={["#71717a", "#e4e4e7"]}
            backgroundColor="#09090b"
            selectable={false}
          />
          <text fg="#71717a">
            KEA · {session.title} · {session.model.provider}/{session.model.model}
          </text>
        </box>
        {children}
        <box paddingX={2}>
          <text>
            <span fg="#60a5fa">/</span>
            <span fg="#71717a"> commands · Enter submit · Shift+Enter newline</span>
          </text>
        </box>
      </box>
    </box>
  );
}
