import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

export function assertGlobalPackageReferenceRemoved(manifestPath: string): void {
  if (!existsSync(manifestPath)) return;

  const globalPackage = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  assert.equal(
    globalPackage.dependencies?.["kea-agent"],
    undefined,
    "global package manifest still references kea-agent",
  );
}
