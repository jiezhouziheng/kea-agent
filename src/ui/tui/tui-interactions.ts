import type {
  InteractionOptions,
  UserInteraction,
} from "../../coding-agent/index.js";

export type TuiInteractionRequest =
  | {
      readonly kind: "select";
      readonly title: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: "confirm";
      readonly title: string;
      readonly message: string;
    }
  | {
      readonly kind: "input";
      readonly title: string;
      readonly placeholder: string | undefined;
    };

export interface TuiInteractionsOptions {
  readonly show: (request: TuiInteractionRequest | undefined) => void;
}

type Answer = number | boolean | string;
type Result = number | boolean | string | undefined;

interface PendingInteraction {
  readonly request: TuiInteractionRequest;
  readonly neutral: Result;
  readonly normalize: (answer: Answer) => Result;
  readonly resolve: (value: Result) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal | undefined;
  abort: (() => void) | undefined;
}

/** React-facing adapter for the Coding Agent's reverse UserInteraction port. */
export class TuiInteractions implements UserInteraction {
  private readonly show: TuiInteractionsOptions["show"];
  private pending: PendingInteraction | undefined;
  private closed = false;

  constructor(options: TuiInteractionsOptions) {
    this.show = options.show;
  }

  select(
    title: string,
    options: readonly string[],
    opts?: InteractionOptions,
  ): Promise<number | undefined> {
    return this.open(
      { kind: "select", title, options: [...options] },
      undefined,
      (answer) => {
        if (
          typeof answer !== "number"
          || !Number.isInteger(answer)
          || answer < 0
          || answer >= options.length
        ) {
          throw new Error("Invalid answer for select interaction");
        }
        return answer;
      },
      opts,
    ) as Promise<number | undefined>;
  }

  confirm(
    title: string,
    message: string,
    opts?: InteractionOptions,
  ): Promise<boolean> {
    return this.open(
      { kind: "confirm", title, message },
      false,
      (answer) => {
        if (typeof answer !== "boolean") {
          throw new Error("Invalid answer for confirm interaction");
        }
        return answer;
      },
      opts,
    ) as Promise<boolean>;
  }

  input(
    title: string,
    placeholder?: string,
    opts?: InteractionOptions,
  ): Promise<string | undefined> {
    return this.open(
      { kind: "input", title, placeholder },
      undefined,
      (answer) => {
        if (typeof answer !== "string") {
          throw new Error("Invalid answer for input interaction");
        }
        const value = answer.trim();
        return value === "" ? undefined : value;
      },
      opts,
    ) as Promise<string | undefined>;
  }

  answer(value: Answer): void {
    const pending = this.pending;
    if (pending === undefined) return;

    let result: Result;
    try {
      result = pending.normalize(value);
    } catch (error) {
      this.reject(pending, error);
      return;
    }

    const hideError = this.clear(pending);
    if (hideError === undefined) pending.resolve(result);
    else pending.reject(hideError);
  }

  cancel(): void {
    const pending = this.pending;
    if (pending === undefined) return;
    const hideError = this.clear(pending);
    if (hideError === undefined) pending.resolve(pending.neutral);
    else pending.reject(hideError);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.pending;
    if (pending === undefined) return;
    this.clear(pending);
    pending.resolve(pending.neutral);
  }

  private open(
    request: TuiInteractionRequest,
    neutral: Result,
    normalize: PendingInteraction["normalize"],
    opts: InteractionOptions | undefined,
  ): Promise<Result> {
    if (this.closed) {
      return Promise.reject(new Error("TuiInteractions is closed"));
    }
    if (this.pending !== undefined) {
      return Promise.reject(new Error("TuiInteractions already has a pending request"));
    }

    const signal = opts?.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);

    return new Promise<Result>((resolve, reject) => {
      const pending: PendingInteraction = {
        request,
        neutral,
        normalize,
        resolve,
        reject,
        signal,
        abort: undefined,
      };
      if (signal !== undefined) {
        pending.abort = () => {
          if (this.pending !== pending) return;
          this.clear(pending);
          reject(signal.reason);
        };
        signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.pending = pending;

      try {
        this.show(request);
      } catch (error) {
        this.pending = undefined;
        if (pending.abort !== undefined) {
          signal?.removeEventListener("abort", pending.abort);
        }
        reject(error);
      }
    });
  }

  private reject(pending: PendingInteraction, reason: unknown): void {
    this.clear(pending);
    pending.reject(reason);
  }

  private clear(pending: PendingInteraction): unknown | undefined {
    if (this.pending !== pending) return undefined;
    this.pending = undefined;
    if (pending.abort !== undefined) {
      pending.signal?.removeEventListener("abort", pending.abort);
    }
    try {
      this.show(undefined);
      return undefined;
    } catch (error) {
      return error;
    }
  }
}
