import { expect, test } from "bun:test"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { tmpdir } from "./fixture/tmpdir"

test("a write waits up to 30 s for a lock another process holds", async () => {
  await using tmp = await tmpdir()
  const row = await Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)
  }).pipe(
    Effect.provide(Database.layerFromPath(path.join(tmp.path, "opencode.db"))),
    Effect.scoped,
    Effect.runPromise,
  )
  expect(row?.timeout).toBe(30_000)
})
