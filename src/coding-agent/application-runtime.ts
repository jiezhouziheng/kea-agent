import type { AgentHarness } from "../core/harness/index.js";
import {
  NoUserInteraction,
  type UserInteraction,
} from "./user-interaction.js";
import type { Project } from "./project/project.js";

type HarnessListener = Parameters<AgentHarness["subscribe"]>[0];

interface RuntimeSubscription {
  readonly listener: HarnessListener;
  unsubscribeHarness: () => void;
  active: boolean;
}

/** Owns the current Harness selection for one running Kea application. */
export class ApplicationRuntime {
  readonly project: Project;

  private currentHarness: AgentHarness;
  private readonly subscriptions = new Set<RuntimeSubscription>();
  private closed = false;

  constructor(project: Project, initialHarness: AgentHarness) {
    this.project = project;
    this.currentHarness = initialHarness;
  }

  get current(): AgentHarness {
    return this.currentHarness;
  }

  async newSession(): Promise<AgentHarness> {
    return this.replaceCurrent(
      () => this.project.createHarness(),
    );
  }

  async switchSession(sessionId: string): Promise<AgentHarness> {
    return this.replaceCurrent(
      () => this.project.createHarnessFromSession(sessionId),
    );
  }

  /** Replace the external interaction implementation for this application. */
  bindUserInteraction(interaction: UserInteraction): void {
    this.assertOpen();
    this.project.bindUserInteraction(interaction);
  }

  private async replaceCurrent(
    create: () => Promise<AgentHarness>,
  ): Promise<AgentHarness> {
    this.assertOpen();
    const current = this.currentHarness;
    if (current.isRunning) {
      throw new Error("Cannot replace the current Harness while it is running");
    }

    const candidate = await create();
    for (const subscription of this.subscriptions) {
      subscription.unsubscribeHarness();
    }
    this.currentHarness = candidate;
    for (const subscription of this.subscriptions) {
      subscription.unsubscribeHarness = candidate.subscribe(subscription.listener);
    }
    return candidate;
  }

  /** Subscribes to the current Harness and follows successful replacements. */
  subscribe(listener: HarnessListener): () => void {
    this.assertOpen();
    const subscription: RuntimeSubscription = {
      listener,
      unsubscribeHarness: this.currentHarness.subscribe(listener),
      active: true,
    };
    this.subscriptions.add(subscription);

    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      subscription.unsubscribeHarness();
      this.subscriptions.delete(subscription);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions) {
      subscription.active = false;
      subscription.unsubscribeHarness();
    }
    this.subscriptions.clear();
    this.project.bindUserInteraction(new NoUserInteraction());
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("ApplicationRuntime is closed");
  }
}
