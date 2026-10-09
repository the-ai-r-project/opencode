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
import { SessionV1 } from "@opencode-ai/core/v1/session"

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

describe("agent.start", () => {
  it.instance(
    "agent.start trigger works as expected with Plugin.Service",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async (_input, output) => {`,
          "    // no modification to output",
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin.trigger(
            "agent.start",
            {
              sessionID: "ses_test",
              agent: "build",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
              messageID: "msg_test",
            },
            { context: [] as string[], abort: false, reason: "" },
          )
          expect(out).toEqual({ context: [], abort: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "hook options include sessionID, agent, model, messageID",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async (input, output) => {`,
          "    output.context = [JSON.stringify(input)]",
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const options = {
            sessionID: "ses_12345",
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
            messageID: "msg_67890",
          }
          const out = yield* plugin.trigger(
            "agent.start",
            options,
            { context: [] as string[], abort: false, reason: "" },
          )
          expect(out.context).toBeDefined()
          expect(out.context?.length).toBe(1)
          const parsed = JSON.parse(out.context![0])
          expect(parsed.sessionID).toBe("ses_12345")
          expect(parsed.agent).toBe("build")
          expect(parsed.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
          expect(parsed.messageID).toBe("msg_67890")
        }),
      ),
    15000,
  )

  it.instance(
    "context injection: returns injected context strings in output",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async (_input, output) => {`,
          `    output.context = ["Synthetic workspace context 1", "Synthetic workspace context 2"]`,
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin.trigger(
            "agent.start",
            {
              sessionID: "ses_test",
              agent: "build",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
              messageID: "msg_test",
            },
            { context: [] as string[], abort: false, reason: "" },
          )
          expect(out.context).toEqual([
            "Synthetic workspace context 1",
            "Synthetic workspace context 2",
          ])
          expect(out.abort).toBe(false)
        }),
      ),
    15000,
  )

  it.instance(
    "pre-flight abort: sets abort: true and reason and returns expected output",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async (_input, output) => {`,
          "    output.abort = true",
          '    output.reason = "Turn aborted by security policy"',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin.trigger(
            "agent.start",
            {
              sessionID: "ses_test",
              agent: "build",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
              messageID: "msg_test",
            },
            { context: [] as string[], abort: false, reason: "" },
          )
          expect(out.abort).toBe(true)
          expect(out.reason).toBe("Turn aborted by security policy")
        }),
      ),
    15000,
  )

  it.instance(
    "error tolerance: defaults to abort: false and empty context when hook throws an error",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async () => {`,
          '    throw new Error("Hook error")',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin
            .trigger(
              "agent.start",
              {
                sessionID: "ses_test",
                agent: "build",
                model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
                messageID: "msg_test",
              },
              { context: [] as string[], abort: false, reason: "" },
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agent.start hook failed", {
                  "session.id": "ses_test",
                  error: Cause.squash(cause),
                }).pipe(Effect.as({ context: [] as string[], abort: false, reason: "" })),
              ),
            )
          expect(out).toEqual({ context: [], abort: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "error tolerance: defaults to abort: false and empty context when hook rejects",
    () =>
      withProject(
        [
          "export default async () => ({",
          `  "agent.start": async () => {`,
          '    return Promise.reject(new Error("Hook rejection"))',
          "  },",
          "})",
          "",
        ].join("\n"),
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const out = yield* plugin
            .trigger(
              "agent.start",
              {
                sessionID: "ses_test",
                agent: "build",
                model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
                messageID: "msg_test",
              },
              { context: [] as string[], abort: false, reason: "" },
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agent.start hook failed", {
                  "session.id": "ses_test",
                  error: Cause.squash(cause),
                }).pipe(Effect.as({ context: [] as string[], abort: false, reason: "" })),
              ),
            )
          expect(out).toEqual({ context: [], abort: false, reason: "" })
        }),
      ),
    15000,
  )

  it.instance(
    "PromptAbortedError: tagged error shape and message",
    () =>
      Effect.gen(function* () {
        const error = new SessionV1.PromptAbortedError({ message: "Execution cancelled" })
        expect(error._tag).toBe("PromptAbortedError")
        expect(error.message).toBe("Execution cancelled")
        expect(error instanceof Error).toBe(true)
      }),
  )
})
