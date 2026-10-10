delete process.env["OPENCODE_CONFIG_DIR"]
delete process.env["OPENCODE_CONFIG"]

import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

function makeMcp(instructions: MCP.ServerInstructions[] = []) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => Effect.succeed(instructions),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
])

function makeHttp() {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp()],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  return LayerNode.compile(root, replacements)
}

const it = testEffect(makeHttp())

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    model: "test/test-model",
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }, null, 2),
  )
})

const usePlugin = Effect.fn("test.usePlugin")(function* (pluginSource: string) {
  const test = yield* TestInstance
  const llm = yield* TestLLMServer
  const pluginFile = path.join(test.directory, "plugin.ts")
  yield* writeText(pluginFile, pluginSource)
  yield* writeConfig(test.directory, {
    ...providerCfg(llm.url),
    plugin: [pathToFileURL(pluginFile).href],
  })
  return { dir: test.directory, llm }
})

describe("agent.stop", () => {
  it.instance(
    "agent.stop triggers on loop completion",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const markerFile = path.join(test.directory, "stop-called.json")
        const { llm } = yield* usePlugin(
          [
            "import fs from 'fs'",
            "export default async () => ({",
            `  "agent.stop": async (input, output) => {`,
            `    fs.writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify(input))`,
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Stop Trigger",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* llm.text("completion response")

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "hello" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((p) => p.type === "text" && p.text === "completion response")).toBe(true)
        expect(yield* llm.calls).toBe(1)

        const markerExists = yield* Effect.promise(() => Bun.file(markerFile).exists())
        expect(markerExists).toBe(true)

        const raw = yield* Effect.promise(() => Bun.file(markerFile).text())
        const parsed = JSON.parse(raw)
        expect(parsed.sessionID).toBe(session.id)
        expect(parsed.agent).toBe("build")
        expect(parsed.messageID).toBe(result.info.id)
        expect(parsed.stopHookActive).toBe(false)
        expect(parsed.stopContinuations).toBe(0)
      }),
    30000,
  )

  it.instance(
    "agent.stop with continue: true injects synthetic user message and continues loop",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => {",
            "  let continued = false",
            "  return {",
            `    "agent.stop": async (_input, output) => {`,
            "      if (!continued) {",
            "        continued = true",
            "        output.continue = true",
            '        output.reason = "check failed"',
            "      }",
            "    },",
            "  }",
            "}",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Stop Continue",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("first reply")
        yield* llm.text("second reply")

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "initial prompt" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((p) => p.type === "text" && p.text === "second reply")).toBe(true)

        expect(yield* llm.calls).toBe(2)
        expect(yield* llm.hits).toHaveLength(2)

        const msgs = yield* sessions.messages({ sessionID: session.id })
        const syntheticMsgs = msgs.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.synthetic && (p as any).metadata?.stop_continue === true),
        )
        expect(syntheticMsgs).toHaveLength(1)
        const syntheticPart = syntheticMsgs[0].parts.find(
          (p) => p.type === "text" && p.synthetic && (p as any).metadata?.stop_continue === true,
        )
        expect(syntheticPart?.type).toBe("text")
        expect((syntheticPart as SessionV1.TextPart).text).toBe("check failed")
      }),
    30000,
  )

  it.instance(
    "agent.stop caps at 5 continuations when plugin always continues",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => ({",
            `  "agent.stop": async (_input, output) => {`,
            "    output.continue = true",
            '    output.reason = "always continue"',
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Stop Cap",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        for (let i = 1; i <= 6; i++) {
          yield* llm.text(`reply ${i}`)
        }

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "initial prompt" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((p) => p.type === "text" && p.text === "reply 6")).toBe(true)

        expect(yield* llm.calls).toBe(6)
        expect(yield* llm.hits).toHaveLength(6)

        const msgs = yield* sessions.messages({ sessionID: session.id })
        const syntheticMsgs = msgs.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.synthetic && (p as any).metadata?.stop_continue === true),
        )
        expect(syntheticMsgs).toHaveLength(5)
      }),
    30000,
  )

  it.instance(
    "agent.stop defect tolerance: completes without crashing when hook throws",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => ({",
            `  "agent.stop": async () => {`,
            '    throw new Error("Plugin agent.stop exploded")',
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Stop Tolerance",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("clean reply")

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "initial prompt" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((p) => p.type === "text" && p.text === "clean reply")).toBe(true)
        expect(yield* llm.calls).toBe(1)
      }),
    30000,
  )
})
