delete process.env["OPENCODE_CONFIG_DIR"]
delete process.env["OPENCODE_CONFIG"]

import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
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

describe("agent.start", () => {
  it.instance(
    "agent.start injects context strings as synthetic parts into user message before LLM inference",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => ({",
            `  "agent.start": async (_input, output) => {`,
            `    output.context = ["Synthetic workspace context 1", "Synthetic workspace context 2"]`,
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Start Context",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("reply")

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "hello" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(yield* llm.calls).toBe(1)

        const msgs = yield* sessions.messages({ sessionID: session.id })
        const userMsg = msgs.find((m) => m.info.role === "user")
        expect(userMsg).toBeDefined()

        const syntheticParts = userMsg!.parts.filter((p) => p.type === "text" && p.synthetic)
        expect(syntheticParts.map((p) => (p as SessionV1.TextPart).text)).toEqual([
          "Synthetic workspace context 1",
          "Synthetic workspace context 2",
        ])
      }),
    30000,
  )

  it.instance(
    "agent.start with abort: true halts before LLM calls and produces error assistant message",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => ({",
            `  "agent.start": async (_input, output) => {`,
            "    output.abort = true",
            '    output.reason = "Blocked"',
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Start Abort",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "hello" }],
        })

        const hits = yield* llm.hits
        expect(hits).toHaveLength(0)

        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") {
          expect(result.info.finish).toBe("error")
          expect(result.info.error).toBeDefined()
          expect(result.info.error?.name).toBe("PromptAbortedError")
          expect(result.info.error?.data).toEqual({ message: "Blocked" })
          expect("message" in (result.info.error?.data ?? {})).toBe(true)
          expect((result.info.error?.data as any)?.message).toBe("Blocked")
          expect(
            "message" in result.info.error!.data && typeof (result.info.error!.data as any).message === "string",
          ).toBe(true)
        }

        const textPart = result.parts.find((p) => p.type === "text") as SessionV1.TextPart | undefined
        expect(textPart?.text).toBe("Blocked")
        expect(textPart?.synthetic).toBe(true)
      }),
    30000,
  )

  it.instance(
    "agent.start verifies isSubagent and noReply discriminators",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const recordsFile = path.join(test.directory, "records.json")
        const { llm } = yield* usePlugin(
          [
            "import fs from 'fs'",
            "export default async () => {",
            "  return {",
            `    "agent.start": async (input, output) => {`,
            `      const file = ${JSON.stringify(recordsFile)}`,
            "      const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : []",
            "      current.push(input)",
            "      fs.writeFileSync(file, JSON.stringify(current))",
            "      if (input.noReply) {",
            "        output.abort = true",
            '        output.reason = "Aborted on noReply"',
            "      }",
            "    },",
            "  }",
            "}",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        // 1. Root session (no parentID) -> isSubagent: false
        const root = yield* sessions.create({
          title: "Root Session",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* llm.text("root reply")
        const rootResult = yield* prompt.prompt({
          sessionID: root.id,
          agent: "build",
          parts: [{ type: "text", text: "root prompt" }],
        })
        expect(rootResult.info.role).toBe("assistant")

        // 2. Subagent session (with parentID) -> isSubagent: true
        const sub = yield* sessions.create({
          title: "Subagent Session",
          parentID: root.id,
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* llm.text("sub reply")
        const subResult = yield* prompt.prompt({
          sessionID: sub.id,
          agent: "build",
          parts: [{ type: "text", text: "sub prompt" }],
        })
        expect(subResult.info.role).toBe("assistant")

        // 3. noReply: true with abort -> returns user message
        const abortResult = yield* prompt.prompt({
          sessionID: root.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "no reply prompt" }],
        })
        expect(abortResult.info.role).toBe("user")

        // Verify recorded inputs from plugin
        const raw = yield* Effect.promise(() => Bun.file(recordsFile).text())
        const records = JSON.parse(raw)
        expect(records).toHaveLength(3)

        // Record 1: root session
        expect(records[0].sessionID).toBe(root.id)
        expect(records[0].isSubagent).toBe(false)
        expect(records[0].noReply).toBe(false)

        // Record 2: subagent session
        expect(records[1].sessionID).toBe(sub.id)
        expect(records[1].isSubagent).toBe(true)
        expect(records[1].noReply).toBe(false)

        // Record 3: noReply call
        expect(records[2].noReply).toBe(true)
      }),
    30000,
  )

  it.instance(
    "agent.start defect tolerance: proceeds without crashing when hook throws",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* usePlugin(
          [
            "export default async () => ({",
            `  "agent.start": async () => {`,
            '    throw new Error("Plugin agent.start exploded")',
            "  },",
            "})",
          ].join("\n"),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Start Tolerance",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("normal reply")

        const result = yield* prompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "initial prompt" }],
        })

        expect(result.info.role).toBe("assistant")
        expect(result.parts.some((p) => p.type === "text" && p.text === "normal reply")).toBe(true)
        expect(yield* llm.calls).toBe(1)
      }),
    30000,
  )

  it.instance("PromptAbortedError: named error schema and decoding", () =>
    Effect.gen(function* () {
      const decoded = Schema.decodeUnknownSync(SessionV1.PromptAbortedError.Schema)({
        name: "PromptAbortedError",
        data: { message: "Execution cancelled" },
      })
      expect(decoded.name).toBe("PromptAbortedError")
      expect(decoded.data.message).toBe("Execution cancelled")
    }),
  )
})
