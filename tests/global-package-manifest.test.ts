import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertGlobalPackageReferenceRemoved } from "../scripts/global-package-manifest.js";

test("an absent global manifest means the package reference was removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kea-global-manifest-"));
  try {
    expect(() => {
      assertGlobalPackageReferenceRemoved(join(directory, "package.json"));
    }).not.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a retained global manifest without kea-agent is accepted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kea-global-manifest-"));
  const manifestPath = join(directory, "package.json");
  try {
    await writeFile(manifestPath, JSON.stringify({ dependencies: { other: "1.0.0" } }));
    expect(() => {
      assertGlobalPackageReferenceRemoved(manifestPath);
    }).not.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a malformed retained global manifest still fails verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kea-global-manifest-"));
  const manifestPath = join(directory, "package.json");
  try {
    await writeFile(manifestPath, "{");
    expect(() => {
      assertGlobalPackageReferenceRemoved(manifestPath);
    }).toThrow(SyntaxError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a retained kea-agent manifest reference still fails verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kea-global-manifest-"));
  const manifestPath = join(directory, "package.json");
  try {
    await writeFile(manifestPath, JSON.stringify({ dependencies: { "kea-agent": "0.1.0" } }));
    expect(() => {
      assertGlobalPackageReferenceRemoved(manifestPath);
    }).toThrow("global package manifest still references kea-agent");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
