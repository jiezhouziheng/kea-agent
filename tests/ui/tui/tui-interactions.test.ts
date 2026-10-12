import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  TuiInteractions,
  type TuiInteractionRequest,
} from "../../../src/ui/tui/tui-interactions.js";

function recordingInteractions(): {
  readonly interactions: TuiInteractions;
  readonly shown: Array<TuiInteractionRequest | undefined>;
} {
  const shown: Array<TuiInteractionRequest | undefined> = [];
  return {
    interactions: new TuiInteractions({ show: (request) => shown.push(request) }),
    shown,
  };
}

test("publishes serializable requests and resolves submitted answers", async () => {
  const { interactions, shown } = recordingInteractions();

  const selection = interactions.select("Permission", ["Allow", "Deny"]);
  assert.deepEqual(shown.at(-1), {
    kind: "select",
    title: "Permission",
    options: ["Allow", "Deny"],
  });
  interactions.answer(1);
  assert.equal(await selection, 1);
  assert.equal(shown.at(-1), undefined);

  const confirmation = interactions.confirm("Delete", "Continue?");
  assert.deepEqual(shown.at(-1), {
    kind: "confirm",
    title: "Delete",
    message: "Continue?",
  });
  interactions.answer(true);
  assert.equal(await confirmation, true);

  const input = interactions.input("Name", "Kea");
  assert.deepEqual(shown.at(-1), {
    kind: "input",
    title: "Name",
    placeholder: "Kea",
  });
  interactions.answer("  parrot  ");
  assert.equal(await input, "parrot");
});

test("ordinary cancellation and blank input resolve to neutral values", async () => {
  const { interactions } = recordingInteractions();

  const selection = interactions.select("Select", ["one"]);
  interactions.cancel();
  assert.equal(await selection, undefined);

  const confirmation = interactions.confirm("Confirm", "Continue?");
  interactions.cancel();
  assert.equal(await confirmation, false);

  const input = interactions.input("Input");
  interactions.answer("   ");
  assert.equal(await input, undefined);
});

test("Run abort rejects with the exact reason and clears the request", async () => {
  const { interactions, shown } = recordingInteractions();
  const controller = new AbortController();
  const reason = new Error("cancel run");
  const pending = interactions.select("Permission", ["Allow", "Deny"], {
    signal: controller.signal,
  });

  controller.abort(reason);

  await assert.rejects(pending, (error: unknown) => error === reason);
  assert.equal(shown.at(-1), undefined);

  const alreadyAborted = interactions.confirm("Permission", "Continue?", {
    signal: controller.signal,
  });
  await assert.rejects(alreadyAborted, (error: unknown) => error === reason);
  assert.equal(shown.at(-1), undefined);
});

test("rejects concurrency and invalid answers without displacing the first request", async () => {
  const { interactions } = recordingInteractions();
  const first = interactions.select("First", ["one", "two"]);

  await assert.rejects(
    interactions.input("Second"),
    /TuiInteractions already has a pending request/u,
  );
  interactions.answer(0);
  assert.equal(await first, 0);

  const invalidType = interactions.confirm("Confirm", "Continue?");
  interactions.answer("yes");
  await assert.rejects(invalidType, /Invalid answer for confirm interaction/u);

  const invalidIndex = interactions.select("Select", ["only"]);
  interactions.answer(4);
  await assert.rejects(invalidIndex, /Invalid answer for select interaction/u);
});

test("a show callback failure rejects the request and leaves the adapter reusable", async () => {
  let fail = true;
  const shown: Array<TuiInteractionRequest | undefined> = [];
  const interactions = new TuiInteractions({
    show(request) {
      if (fail) {
        fail = false;
        throw new Error("render failed");
      }
      shown.push(request);
    },
  });

  await assert.rejects(interactions.select("Broken", ["one"]), /render failed/u);

  const next = interactions.confirm("Working", "Continue?");
  interactions.answer(false);
  assert.equal(await next, false);
  assert.equal(shown.at(-1), undefined);
});

test("close is idempotent, settles pending work, and removes abort listeners", async () => {
  const { interactions, shown } = recordingInteractions();
  const controller = new AbortController();
  const pending = interactions.input("Input", undefined, { signal: controller.signal });

  interactions.close();
  interactions.close();
  assert.equal(await pending, undefined);
  assert.equal(shown.at(-1), undefined);

  controller.abort(new Error("too late"));
  interactions.answer("ignored");
  interactions.cancel();
  assert.equal(shown.at(-1), undefined);
});
