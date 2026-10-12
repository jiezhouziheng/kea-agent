import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import {
  createModelRuntime,
  type RuntimeProviderConfig,
} from "../core/ai/factory.js";
import type { ModelConfig, ModelRuntime } from "../core/ai/types.js";
import { SessionRepository } from "../core/harness/session/repository.js";
import { normalizeWindowsDriveRoot } from "../core/util/path.js";
import { ApplicationRuntime } from "./application-runtime.js";
import type { PermissionRule } from "./project/permission/permission.js";
import { Project, ProjectError } from "./project/project.js";
import { ProjectStorage } from "./project/storage.js";

// ── Explicit Project directory boundary ──

/** Validate an application-resolved Project directory at the Coding Agent boundary. */
async function requireProjectDirectory(input: string): Promise<string> {
  const projectDirectory = normalizeWindowsDriveRoot(input);
  if (
    !isAbsolute(projectDirectory)
    || resolve(projectDirectory) !== projectDirectory
  ) {
    throw new ProjectError(
      `Project directory must be absolute and normalized: ${input}`,
    );
  }
  let real: string;
  try {
    real = normalizeWindowsDriveRoot(await realpath(projectDirectory));
  } catch (error) {
    throw new ProjectError(`Project directory does not exist: ${projectDirectory}`, {
      cause: error,
    });
  }
  if (real !== projectDirectory) {
    throw new ProjectError(`Project directory must be canonical: ${projectDirectory}`);
  }
  const info = await stat(real);
  if (!info.isDirectory()) {
    throw new ProjectError(`Project directory is not a directory: ${real}`);
  }
  return real;
}

/**
 * Project runtime composition root.
 *
 * Resolves the durable Project record for an explicit canonical Project
 * directory, then assembles one fresh Project runtime. The returned Project
 * owns one in-memory approval scope shared by all of its Harnesses; each
 * Harness later creates its own Tool Registry, event bus, and hooks. This
 * function never creates a Harness.
 */
export async function openOrCreateProject(options: {
  readonly keaHome: string;
  readonly projectDirectory: string;
  readonly runtime: ModelRuntime;
  readonly modelConfig: ModelConfig;
  readonly models: readonly ModelConfig[];
  readonly maxTurns: number;
  readonly toolTimeoutSeconds: number;
}): Promise<Project> {
  const projectDirectory = await requireProjectDirectory(options.projectDirectory);

  // Reuse the persisted Project record, or create it on first open.
  const storage = new ProjectStorage(options.keaHome);
  let info = await storage.findByDirectory(projectDirectory);
  if (info === undefined) {
    const now = new Date().toISOString();
    info = {
      id: randomUUID(),
      name: basename(projectDirectory) || projectDirectory,
      directory: projectDirectory,
      createdAt: now,
      updatedAt: now,
    };
    await storage.create(info);
  }

  // Assemble fresh Project-scoped runtime state around the durable record.
  const sessions = new SessionRepository(storage.dataDirectory(info.id));
  const approved: PermissionRule[] = [];
  return new Project({
    info,
    sessions,
    runtime: options.runtime,
    modelConfig: options.modelConfig,
    models: options.models,
    maxTurns: options.maxTurns,
    toolTimeoutSeconds: options.toolTimeoutSeconds,
    approved,
  });
}

export interface CreateApplicationRuntimeOptions {
  readonly keaHome: string;
  readonly projectDirectory: string;
  readonly providers: readonly RuntimeProviderConfig[];
  readonly modelConfig: ModelConfig;
  readonly models: readonly ModelConfig[];
  readonly continueSession: boolean;
  readonly maxTurns: number;
  readonly toolTimeoutSeconds: number;
}

/** Assemble one application runtime before a concrete UI adapter exists. */
export async function createApplicationRuntime(
  options: CreateApplicationRuntimeOptions,
): Promise<ApplicationRuntime> {
  const project = await openOrCreateProject({
    keaHome: options.keaHome,
    projectDirectory: options.projectDirectory,
    runtime: createModelRuntime({ providers: options.providers }),
    modelConfig: options.modelConfig,
    models: options.models,
    maxTurns: options.maxTurns,
    toolTimeoutSeconds: options.toolTimeoutSeconds,
  });
  const sessions = options.continueSession ? await project.listSessions() : [];
  const newest = sessions[0];
  const initialHarness = newest === undefined
    ? await project.createHarness()
    : await project.createHarnessFromSession(newest.id);
  return new ApplicationRuntime(project, initialHarness);
}
