import type { SyntaxStyle } from "@opentui/core";

import type { AgentMessage } from "../../../core/harness/index.js";
import type { TuiLiveBlock, TuiState } from "../tui-state.js";

export function Transcript({
  history,
  pendingUser,
  liveTurn,
  thinking,
  toolDetails,
  syntaxStyle,
}: {
  readonly history: TuiState["history"];
  readonly pendingUser: TuiState["pendingUser"];
  readonly liveTurn: TuiState["liveTurn"];
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly syntaxStyle: SyntaxStyle;
}) {
  return (
    <scrollbox
      id="transcript"
      flexGrow={1}
      paddingX={2}
      paddingY={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
    >
      <box flexDirection="column" gap={1}>
        {history.map((message, index) => (
          <StoredMessage
            key={`${index}:${message.role}`}
            message={message}
            thinking={thinking}
            toolDetails={toolDetails}
            syntaxStyle={syntaxStyle}
          />
        ))}
        {pendingUser === undefined ? null : (
          <UserMessage text={pendingUser} syntaxStyle={syntaxStyle} />
        )}
        {liveTurn.map((block, index) => (
          <LiveBlock
            key={block.kind === "tool" ? `${block.runId}:${block.id}` : `${index}:${block.kind}`}
            block={block}
            thinking={thinking}
            toolDetails={toolDetails}
            syntaxStyle={syntaxStyle}
          />
        ))}
      </box>
    </scrollbox>
  );
}

function StoredMessage({
  message,
  thinking,
  toolDetails,
  syntaxStyle,
}: {
  readonly message: AgentMessage;
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly syntaxStyle: SyntaxStyle;
}) {
  if (message.role === "user") {
    return <UserMessage text={message.content} syntaxStyle={syntaxStyle} />;
  }
  if (message.role === "tool") {
    return (
      <ToolFact
        name={message.name}
        detail={message.content}
        isError={message.isError ?? false}
        mode={toolDetails}
      />
    );
  }
  return (
    <box flexDirection="column" paddingLeft={1}>
      {message.content.map((block, index) => {
        switch (block.type) {
          case "text":
            return (
              <markdown key={index} content={block.text} syntaxStyle={syntaxStyle} streaming />
            );
          case "thinking":
            return thinking === "visible"
              ? <text key={index} fg="#71717a">{block.thinking}</text>
              : null;
          case "toolCall":
            return (
              <ToolFact
                key={block.id}
                name={block.name}
                detail={JSON.stringify(block.arguments)}
                isError={false}
                mode={toolDetails}
              />
            );
        }
      })}
      <text fg="#71717a">{message.model} · {message.latencyMs}ms</text>
    </box>
  );
}

function UserMessage({ text, syntaxStyle }: {
  readonly text: string;
  readonly syntaxStyle: SyntaxStyle;
}) {
  return (
    <box
      paddingLeft={1}
      paddingY={1}
      border={["left"]}
      borderColor="#60a5fa"
      backgroundColor="#18181b"
    >
      <markdown content={text} syntaxStyle={syntaxStyle} streaming />
    </box>
  );
}

function LiveBlock({
  block,
  thinking,
  toolDetails,
  syntaxStyle,
}: {
  readonly block: TuiLiveBlock;
  readonly thinking: "hidden" | "visible";
  readonly toolDetails: "compact" | "full";
  readonly syntaxStyle: SyntaxStyle;
}) {
  switch (block.kind) {
    case "text":
      return <markdown content={block.text} syntaxStyle={syntaxStyle} streaming />;
    case "thinking":
      return thinking === "visible"
        ? <text fg="#71717a">{block.thinking}</text>
        : null;
    case "tool": {
      const detail = block.result?.content
        ?? block.argumentsText
        ?? (block.call === undefined ? "" : JSON.stringify(block.call.arguments));
      return (
        <ToolFact
          name={block.name ?? "tool"}
          detail={detail}
          isError={block.result?.isError ?? false}
          mode={toolDetails}
        />
      );
    }
  }
}

function ToolFact({
  name,
  detail,
  isError,
  mode,
}: {
  readonly name: string;
  readonly detail: string;
  readonly isError: boolean;
  readonly mode: "compact" | "full";
}) {
  const visible = mode === "compact" && detail.length > 200
    ? `${detail.slice(0, 200)}…`
    : detail;
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={isError ? "#f87171" : "#60a5fa"}>Tool {name}</text>
      {visible === "" ? null : <text fg="#a1a1aa">{visible}</text>}
    </box>
  );
}
