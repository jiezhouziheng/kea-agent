import type { TextareaRenderable } from "@opentui/core";
import type { RefObject } from "react";

import { UI_COMMANDS } from "../../commands.js";
import type { TuiPanel, TuiState } from "../tui-state.js";

export function BottomPanel({
  panel,
  notice,
  run,
  composerValue,
  commandSuggestions,
  commandSelectedIndex,
  composerRef,
  panelInputRef,
  onComposerChanged,
  onComposerSubmitted,
  onPanelInputChanged,
  onInteractionInputSubmitted,
  onPanelMoved,
  onPanelSelected,
}: {
  readonly panel: TuiPanel;
  readonly notice: string | undefined;
  readonly run: TuiState["run"];
  readonly composerValue: string;
  readonly commandSuggestions: readonly (typeof UI_COMMANDS)[number][];
  readonly commandSelectedIndex: number;
  readonly composerRef: RefObject<TextareaRenderable | null>;
  readonly panelInputRef: RefObject<TextareaRenderable | null>;
  readonly onComposerChanged: (value: string) => void;
  readonly onComposerSubmitted: () => void;
  readonly onPanelInputChanged: (value: string) => void;
  readonly onInteractionInputSubmitted: (value: string) => void;
  readonly onPanelMoved: (delta: number) => void;
  readonly onPanelSelected: (index: number) => void;
}) {
  return (
    <box
      minHeight={panel.kind === "composer"
        ? 5 + Math.min(commandSuggestions.length * 2, 10)
        : 9}
      paddingX={2}
      paddingTop={1}
      flexDirection="column"
    >
      {notice === undefined ? null : <text fg="#f87171">{notice}</text>}
      {panel.kind === "composer" ? (
        <box flexDirection="column">
          {commandSuggestions.length === 0 ? null : (
            <select
              focused={false}
              height={Math.max(2, Math.min(commandSuggestions.length * 2, 10))}
              options={commandSuggestions.map((command) => ({
                name: command.token,
                description: command.description,
              }))}
              selectedIndex={commandSelectedIndex}
            />
          )}
          <textarea
            ref={composerRef}
            focused={run.status !== "running"}
            height={3}
            initialValue={composerValue}
            placeholder="Ask Kea anything..."
            backgroundColor="#18181b"
            focusedBackgroundColor="#18181b"
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "kpenter", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "kpenter", shift: true, action: "newline" },
            ]}
            onContentChange={() => onComposerChanged(
              composerRef.current?.editBuffer.getText() ?? "",
            )}
            onSubmit={onComposerSubmitted}
          />
        </box>
      ) : panel.kind === "help" ? (
        <box flexDirection="column">
          <text fg="#60a5fa">Commands</text>
          {UI_COMMANDS.map((command) => (
            <text key={command.token}>{command.token.padEnd(10)} {command.description}</text>
          ))}
          <text fg="#71717a">Escape closes help</text>
        </box>
      ) : panel.kind === "interaction" && panel.request.kind === "input" ? (
        <box flexDirection="column">
          <text fg="#60a5fa">{panel.request.title}</text>
          <textarea
            ref={panelInputRef}
            focused
            height={3}
            initialValue={panel.input}
            placeholder={panel.request.placeholder ?? "Enter a value"}
            backgroundColor="#18181b"
            focusedBackgroundColor="#18181b"
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "kpenter", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "kpenter", shift: true, action: "newline" },
            ]}
            onContentChange={() => onPanelInputChanged(
              panelInputRef.current?.editBuffer.getText() ?? "",
            )}
            onSubmit={() => onInteractionInputSubmitted(
              panelInputRef.current?.editBuffer.getText() ?? panel.input,
            )}
          />
        </box>
      ) : (
        <box flexDirection="column">
          <text fg="#60a5fa">{panelTitle(panel)}</text>
          <select
            focused
            height={Math.max(3, Math.min(panelOptions(panel).length * 2, 6))}
            options={panelOptions(panel)}
            selectedIndex={panel.selectedIndex}
            onChange={(index) => onPanelMoved(index - panel.selectedIndex)}
            onSelect={(index) => onPanelSelected(index)}
          />
        </box>
      )}
    </box>
  );
}

function panelTitle(panel: TuiPanel): string {
  switch (panel.kind) {
    case "sessions":
      return "Sessions (newest first)";
    case "providers":
      return "Providers";
    case "models":
      return panel.reason === "command" ? "Models" : "Choose a configured model";
    case "interaction":
      return panel.request.kind === "confirm"
        ? `${panel.request.title}: ${panel.request.message}`
        : panel.request.title;
    case "composer":
      return "";
    case "help":
      return "Commands";
  }
}

function panelOptions(panel: TuiPanel): Array<{
  readonly name: string;
  readonly description: string;
}> {
  switch (panel.kind) {
    case "sessions":
      return panel.sessions.map((session) => ({
        name: session.title,
        description: session.updatedAt,
      }));
    case "providers":
      return panel.providers.map((provider) => ({ name: provider, description: "" }));
    case "models":
      return panel.models.map((model) => ({
        name: model.model,
        description: model.provider,
      }));
    case "interaction":
      if (panel.request.kind === "select") {
        return panel.request.options.map((option) => ({ name: option, description: "" }));
      }
      if (panel.request.kind === "confirm") {
        return [
          { name: "Yes", description: "" },
          { name: "No", description: "" },
        ];
      }
      return [];
    case "composer":
    case "help":
      return [];
  }
}
