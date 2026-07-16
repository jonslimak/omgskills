import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStaticProfileHandlesReserved,
  buildCreatorHandleOwners,
  buildCreatorHandleReservations,
  buildProfilePathByCreatorHandle,
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

test("maps case and aliases to the exact generated profile path", () => {
  const owners = buildCreatorHandleOwners({
    creators: [
      { handle: "JimLiu" },
      { handle: "NewHandle", aliases: ["OldHandle"] },
    ],
  });
  const paths = buildProfilePathByCreatorHandle(
    [
      { authorHandle: "JIMLIU", urlPath: "/library/jimliu/" },
      { authorHandle: "oldhandle", urlPath: "/library/oldhandle/" },
    ],
    owners,
  );

  assert.equal(paths.get("jimliu"), "/library/jimliu/");
  assert.equal(paths.get("newhandle"), "/library/oldhandle/");
  assert.equal(paths.get("oldhandle"), "/library/oldhandle/");
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
