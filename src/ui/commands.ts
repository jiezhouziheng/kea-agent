export type UiAction =
  | { readonly kind: "prompt"; readonly text: string }
  | { readonly kind: "new-session" }
  | { readonly kind: "switch-session" }
  | { readonly kind: "switch-model" }
  | { readonly kind: "help" }
  | { readonly kind: "exit" }
  | { readonly kind: "command-error"; readonly message: string };

export const UI_COMMANDS = [
  { token: "/new", description: "create a Session", action: { kind: "new-session" } },
  { token: "/session", description: "switch Session", action: { kind: "switch-session" } },
  { token: "/model", description: "switch model", action: { kind: "switch-model" } },
  { token: "/help", description: "show help", action: { kind: "help" } },
  { token: "/exit", description: "exit Kea", action: { kind: "exit" } },
] as const satisfies readonly {
  readonly token: string;
  readonly description: string;
  readonly action: UiAction;
}[];

/**
 * Parse one input line. Only an exact registered slash token at character
 * zero is a command; everything else is an untrimmed Prompt, and a known
 * command with trailing arguments becomes a command error.
 */
export function parseInput(input: string): UiAction {
  if (!input.startsWith("/")) return { kind: "prompt", text: input };
  const [token, ...rest] = input.split(/\s+/);
  const command = UI_COMMANDS.find((candidate) => candidate.token === token)?.action;
  if (command === undefined) return { kind: "prompt", text: input };
  if (rest.join(" ") !== "") {
    return {
      kind: "command-error",
      message: `${token} does not accept arguments`,
    };
  }
  return command;
}
