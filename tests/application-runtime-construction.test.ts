import assert from "node:assert/strict";
import { test } from "bun:test";

import type { AgentHarness } from "../src/core/harness/index.js";
import { ApplicationRuntime } from "../src/coding-agent/application-runtime.js";
import type { Project } from "../src/coding-agent/project/project.js";

function runtimeMustNotExposeUserInteractionOperations(runtime: ApplicationRuntime): void {
  // @ts-expect-error Runtime binds UserInteraction but does not mirror its operations.
  void runtime.select;
}

void runtimeMustNotExposeUserInteractionOperations;

function runtimeMustNotExposeStaticFactory(): void {
  // @ts-expect-error Production assembly belongs to createApplicationRuntime.
  void ApplicationRuntime.create;
}

void runtimeMustNotExposeStaticFactory;

test("ApplicationRuntime supports lightweight internal construction", () => {
  const project = {} as Project;
  const harness = {} as AgentHarness;
  const runtime = new ApplicationRuntime(project, harness);

  assert.equal(runtime.project, project);
  assert.equal(runtime.current, harness);
});
