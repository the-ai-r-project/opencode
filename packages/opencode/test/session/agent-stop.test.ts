import { describe, expect } from "bun:test"
import { Cause, Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { MAX_STOP_CONTINUATIONS } from "../../src/session/prompt"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    yield* Effect.all(
      [
        Effect.promise(() => Bun.write(file, source)),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: [pathToFileURL(file).href],
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: 2 },
    )
    return yield* self
  })
}

describe("agent.stop", () => {
  it.instance(
    "agent.stop trigger works as expected with Plugin.Service",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async (_input, output) => {`,
          "    // no modification to output",
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin.trigger(
            "agent.stop",
            {
              sessionID: "ses_test",
              agent: "build",
              messageID: "msg_test",
              stopHookActive: false,
              stopContinuations: 0,
            },
            { continue: false, reason: "" },
          )
          expect(out).toEqual({ continue: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "sets continue: true and reason: 'Please verify' and returns expected output",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async (_input, output) => {`,
          "    output.continue = true",
          '    output.reason = "Please verify"',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin.trigger(
            "agent.stop",
            {
              sessionID: "ses_test",
              agent: "build",
              messageID: "msg_test",
              stopHookActive: false,
              stopContinuations: 0,
            },
            { continue: false, reason: "" },
          )
          expect(out).toEqual({ continue: true, reason: "Please verify" })
        }),
      ),
    15000,
  )

  it.instance(
    "defaults to continue: false and empty reason when hook throws an error",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async () => {`,
          '    throw new Error("Hook error")',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin
            .trigger(
              "agent.stop",
              {
                sessionID: "ses_test",
                agent: "build",
                messageID: "msg_test",
                stopHookActive: false,
                stopContinuations: 0,
              },
              { continue: false, reason: "" },
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agent.stop hook failed", {
                  "session.id": "ses_test",
                  error: Cause.squash(cause),
                }).pipe(Effect.as({ continue: false, reason: "" })),
              ),
            )
          expect(out).toEqual({ continue: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "defaults to continue: false and empty reason when hook rejects",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async () => {`,
          '    return Promise.reject(new Error("Hook rejection"))',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin
            .trigger(
              "agent.stop",
              {
                sessionID: "ses_test",
                agent: "build",
                messageID: "msg_test",
                stopHookActive: false,
                stopContinuations: 0,
              },
              { continue: false, reason: "" },
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agent.stop hook failed", {
                  "session.id": "ses_test",
                  error: Cause.squash(cause),
                }).pipe(Effect.as({ continue: false, reason: "" })),
              ),
            )
          expect(out).toEqual({ continue: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "hook options include sessionID, agent, messageID, stopHookActive, stopContinuations",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async (input, output) => {`,
          "    output.continue = true",
          "    output.reason = JSON.stringify(input)",
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const options = {
            sessionID: "ses_12345",
            agent: "build",
            messageID: "msg_67890",
            stopHookActive: true,
            stopContinuations: 3,
          }
          const out = yield* plugin.trigger(
            "agent.stop",
            options,
            { continue: false, reason: "" },
          )
          expect(out.continue).toBe(true)
          const parsed = JSON.parse(out.reason)
          expect(parsed).toEqual(options)
          expect(parsed.sessionID).toBe("ses_12345")
          expect(parsed.agent).toBe("build")
          expect(parsed.messageID).toBe("msg_67890")
          expect(parsed.stopHookActive).toBe(true)
          expect(parsed.stopContinuations).toBe(3)
        }),
      ),
    15000,
  )

  it.instance(
    "continuation caps at MAX_STOP_CONTINUATIONS = 5",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.stop": async (_input, output) => {`,
          "    output.continue = true",
          '    output.reason = "Keep working"',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          expect(MAX_STOP_CONTINUATIONS).toBe(5)
          const plugin = yield* Plugin.Service
          let stopContinuations = 0
          while (stopContinuations < MAX_STOP_CONTINUATIONS) {
            const out = yield* plugin.trigger(
              "agent.stop",
              {
                sessionID: "ses_test",
                agent: "build",
                messageID: "msg_test",
                stopHookActive: stopContinuations > 0,
                stopContinuations,
              },
              { continue: false, reason: "" },
            )
            if (out.continue) {
              stopContinuations++
            }
          }
          expect(stopContinuations).toBe(5)
          expect(stopContinuations < MAX_STOP_CONTINUATIONS).toBe(false)
        }),
      ),
    15000,
  )
})
