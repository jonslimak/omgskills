import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStaticProfileHandlesReserved,
  buildCreatorHandleReservations,
  renderCreatorHandleReservations,
} from "./generate-creator-handle-reservations.mjs";

test("normalizes and sorts creator handles and aliases", () => {
  const handles = buildCreatorHandleReservations({
    creators: [
      { handle: "Zulu", aliases: ["Old-Zulu"] },
      { handle: "alpha" },
    ],
  });

  assert.deepEqual(handles, ["alpha", "old-zulu", "zulu"]);
  assert.match(renderCreatorHandleReservations(handles), /"old-zulu"/);
});

test("rejects invalid handles", () => {
  assert.throws(
    () => buildCreatorHandleReservations({ creators: [{ handle: "bad_handle" }] }),
    /Invalid creator handle or alias/,
  );
});

test("rejects case-insensitive collisions between creators", () => {
  assert.throws(
    () => buildCreatorHandleReservations({
      creators: [
        { handle: "first", aliases: ["Shared"] },
        { handle: "shared" },
      ],
    }),
    /Creator handle collision: shared belongs to both first and shared/,
  );
});

test("rejects static profiles outside the reserved registry", () => {
  assert.doesNotThrow(() => assertStaticProfileHandlesReserved(
    [{ type: "author", authorHandle: "Known" }, { type: "topic", id: "starter" }],
    ["known"],
  ));
  assert.throws(
    () => assertStaticProfileHandlesReserved(
      [{ type: "author", authorHandle: "unregistered" }],
      ["known"],
    ),
    /Static profile handle is not reserved: unregistered/,
  );
});
