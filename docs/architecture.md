# Kea Agent 架构

**更新：** 2026-08-25

本文描述当前代码的所有权与边界。`ai`、`harness` 共同组成 `src/core/` 下的 Harness 核心。依赖
方向是 `main -> ui -> coding-agent -> core/harness -> core/ai`；`coding-agent/cli` 与
`coding-agent/config` 提供配置、参数、模板和目录发现等无长期状态的启动能力，`main.ts` 是连接
具体 UI、Coding Agent 和 AI provider 的唯一组合根。

观察事件与控制钩子都由 `harness` 拥有（`HarnessEventBus` + `HarnessHooks`），不存在独立的
`events` 包。

## 1. AI：LLM 流式协议与显式 Provider

`src/core/ai/` 统一 Anthropic、OpenAI 和 Gemini 的流式协议，不保存会话，也不执行工具。

```ts
interface ModelConfig {
  readonly provider: string;
  readonly model: string;
}

type ProtocolId = "anthropic" | "openai" | "gemini";

interface RuntimeProviderConfig {
  readonly name: string;            // 配置的 provider 名，例如 "deepseek"
  readonly protocol: ProtocolId;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

function createModelRuntime(options: {
  readonly providers: readonly RuntimeProviderConfig[];
}): ModelRuntime;
```

`createModelRuntime()` 只接收显式 Provider 列表；`ModelRuntime` 拥有 provider 路由和 lazy
adapter，`ModelConfig` 是“这次请求选择哪个模型”的值，两者分离。Runtime 不保存默认模型；
同一个 Runtime 可服务多个 provider、Session 和模型切换。`ModelRuntime.stream(modelConfig,
context)` 的请求路由到 `modelConfig.provider` 对应的 adapter，请求未配置的 provider 会抛出
`Unknown provider`。provider 是用户配置的连接实例（name/baseUrl/apiKey/protocol/models），
协议决定 adapter；多个 provider 可共用同一协议。默认模型由 `Config.defaultModel` 显式指定。

`ToolResultMessage.content` 是模型可见文本；`details` 是 Session、Agent 和 UI 使用的结构化数据，
不会被 provider adapter 发到模型服务。

`StreamChunk` 是一次 provider 响应中的一个片段，由 Agent 直接消费；它不是运行事件（不注册、
发布或观察），只是从 provider 到 agent 的数据传输。每一轮 Stream 必须以 `done` 或 `error`
终止块结束；Agent 在缺少终止块时让 Run 失败，不发布没有完整消息的 `turn-end`。

## 2. 观察事件与控制钩子

`harness` 把“观察”与“控制”明确分开，且都由调用方创建后注入 `AgentHarness`。

### 观察事件：`HarnessEventBus`（`src/core/harness/events.ts`）

`HarnessEventBus` 是纯观察总线：`on(type, listener)` 注册，`emit(event)` 发布；listener 返回
`void`，逐个按注册顺序 await，异常经错误处理器隔离，不改变 harness 执行。

事件类型是 `HarnessEvent` 的判别联合，携带 `runId`（无 `sessionId`，因为每个 Harness 已绑定
一份 Session）：

- Run 边界：`run-start`、`run-end`；
- Turn 边界：`turn-start`、`turn-end`；
- 流式：`text-start`/`text-end`、`thinking-start`/`thinking-end`、`text-delta`、
  `thinking-delta`；
- Tool：`tool-call-start`、`tool-call-delta`、`tool-call`、`tool-result`。

### 控制钩子：`HarnessHooks`（`src/core/harness/hooks.ts`）

`HarnessHooks` 是一组**固定命名**的控制点，handler 通过返回值影响流程：

```ts
type HookName = "beforePrompt" | "transformContext" | "beforeTool";

// beforePrompt(prompt, ctx) → string | undefined   （改写 prompt；undefined 停止 Run）
// transformContext(messages, ctx) → messages        （整理每次 LLM 请求快照）
// beforeTool(call, ctx) → PreToolDecision           （{allow} | {deny, reason?}，权限用）
```

多 handler 通过统一原语组合：变换钩子链式传递，`beforeTool` 首个 `deny` 短路。

## 3. Agent Harness：通用 agent 运行时

`src/core/harness/` 是通用 agent 的实现，包含三大能力与一个组合根：

- **agent-loop**：`runAgentLoop()` 无状态执行一次多 Turn Agent Run；
- **tools**：`AgentTool`/`AgentToolRegistry` 提供工具定义、校验与执行，权限经 `beforeTool`
  钩子完成；
- **session**：`Session`/`SessionRepository` 提供会话数据与持久化；
- **AgentHarness**：session-bound 的组合根，把三者绑成一份 Session 的运行器。

### agent-loop

`runAgentLoop()` 接收用户输入、`AgentContext`、`AgentLoopConfig` 与 `StreamFn`，并产生
`Promise<void>`。

```ts
function runAgentLoop(
  input: string,
  context: AgentContext,
  config: AgentLoopConfig,
  streamFn: StreamFn,
): Promise<void>;
```

`AgentLoopConfig` 携带本轮模型选择（`model`）、可选 `maxTurns` 上限和 `convertToLlm` 消息
转换。`AgentContext` 提供 Run 身份、system prompt、消息、Tool Registry、观察总线 `events`、
控制钩子 `hooks` 和取消信号；`appendMessage()` 由 Harness 提供，负责把完整消息持久化后再发布
事实事件。

一个 Turn 的顺序：`turn-start` → `hooks.transformContext`（整理消息快照）→ 流式
`text-delta`/`thinking-delta`/`tool-call-*` → `done` 终止块后完整 assistant 消息写入 →
逐个执行 Tool → `turn-end`。用户 prompt 先经 `hooks.beforePrompt` 处理。Turn 后是否继续由
Agent Loop 内建决定：本轮有 Tool Result 就继续，让模型消费结果；没有则结束。

### Tool

每个 Tool Call 在 `AgentToolRegistry.execute()` 内先做 lookup 和 TypeBox 校验，再调用
`hooks.beforeTool` 做权限决策；拒绝时统一转换成错误结果。允许后经 timeout helper 调用 Tool
本体。未知、无效、被阻止、已中止或失败的调用都以恰好一个 `tool-result` 结束。不存在
`tools/pre-execute`/`execute`/`post-execute` 三阶段拦截——控制只通过 `beforeTool` 钩子。

### session

`Session` 保存由消息与模型选择组成的节点树、当前 head 和 Session 元数据。持久化格式是
`<storageDir>/sessions/<sessionId>.jsonl` 的树形 entry；`path()` 恢复从根到当前 head（或指定
节点）的路径，`messages()` 和 `modelSelection()` 分别从该路径读取消息和最后选择的模型。标题是
header 字段（`setTitle` 原地重写 header），不是追加记录。

`SessionRepository.create()` 返回的新空 Session 先只存在于内存中，不创建 JSONL，也不出现在
`list()` 中。第一条经过 `beforePrompt` 接受的 user message 到达 `Session.append()` 时，Session 用
一次 `storage.create()` 原子发布 header、此前留在内存中的模型选择和该 user message；之后的节点
与标题继续使用 append/header rewrite。因而用户未发送 Prompt 就关闭应用时没有 Session 文件需要
清理；打开、列举和 fork 得到的已有 Session 始终是持久状态。

```ts
interface SessionMetadata {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly parentSessionId?: string;
}

class SessionRepository {
  constructor(storageDir: string);
  create(options: { readonly cwd: string }): Promise<Session>;
  open(sessionId: string): Promise<Session>;
  list(): Promise<readonly SessionMetadata[]>;
  fork(sourceSessionId: string, nodeId: string | null): Promise<Session>;
  delete(sessionId: string): Promise<void>;
}
```

### AgentHarness

一个 `AgentHarness` 在构造时绑定恰好一份 Session，之后不切换。它公开 Run 控制、模型与 Tool
修改、标题修改、状态读取、`hooks` 和 `subscribe`，但不暴露可写 Session 或 Repository。

```ts
interface HarnessConfig {
  readonly session: Session;
  readonly runtime: ModelRuntime;
  readonly modelConfig: ModelConfig;
  readonly maxTurns?: number;
  readonly toolRegistry: AgentToolRegistry;
  readonly systemPrompt: string;
  readonly events: HarnessEventBus;   // 观察事件总线，调用方创建
  readonly hooks: HarnessHooks;       // 控制钩子，调用方创建并预注册
}

class AgentHarness {
  constructor(config: HarnessConfig);
  prompt(input: string): Promise<void>;
  abort(): void;
  switchModel(model: ModelConfig): Promise<void>;
  registerTool(tool: AgentTool): void;
  unregisterTool(name: string): void;
  setTitle(title: string): Promise<void>;
  subscribe(listener: (event: HarnessEvent) => void): () => void;
  get hooks(): HarnessHooks;
  get sessionId(): string;
  get title(): string;
  get model(): ModelConfig;
  get messages(): readonly AgentMessage[];
  get isRunning(): boolean;
}
```

Harness 为这份 Session 持有消息视图、当前模型、Tool Registry、AbortController 和 run 状态。
`prompt()` 创建 Run 身份（`sessionId`、`runId`），在自持总线上发布 `run-start`，调用一次
`runAgentLoop()`，并发布 `run-end`。同一个 Harness 同时只运行一个 `prompt()`；运行时切换模型或
修改 Tool 会抛错。构造时 Session 已保存的模型优先于 `modelConfig`；`switchModel()` 先持久化
`model_selection` 再更新当前模型。

`subscribe(listener)` 把 Harness 发布到自持总线上的 `HarnessEvent` 直接转交给 listener（每个
Harness 绑定一份 Session，无需按 `sessionId` 过滤），返回幂等取消函数。`hooks` 暴露控制钩子
注册面，供调用方在创建 `HarnessHooks` 时预注册。

## 4. Coding Agent：Project 级所有者

`src/coding-agent/` 管理持久化 Project，并为每份打开的 Session 建立 coding Harness。

```ts
function createApplicationRuntime(
  options: CreateApplicationRuntimeOptions,
): Promise<ApplicationRuntime>;
```

`createApplicationRuntime()` 是生产入口使用的组合根。目录发现属于 application 层：应用把启动
目录解析为 Git worktree 根（或原目录）并规范化，再把规范结果作为 `projectDirectory` 传入；
Coding Agent 只校验该目录（绝对、`resolve()` 后不变、`realpath()` 后不变、且是现存目录），
不运行 Git。

Project 记录持久化在 `<keaHome>/projects/<projectId>/project.json`，通过规范目录查找复用。找不到
记录时生成 UUID、目录名和 UTC 时间创建新记录。Project 持有内存权限状态（`approved`）和当前
`UserInteraction`，初始使用 `NoUserInteraction`。`ApplicationRuntime.bindUserInteraction()` 只把
应用级绑定委托给 Project；切换 Harness 时不迁移交互状态。

`Project.createHarness()` / `createHarnessFromSession()` 逐 Harness 装配：用
`createBuiltinToolRegistry(cwd, timeout)` 建工具、用 Project 私有 `createHooks()` 建已注册权限回调的
`HarnessHooks`、用 `new HarnessEventBus()` 建观察总线，连同 system prompt 一起注入
`AgentHarness`。Project 不对外暴露注册 Tool / Hook 的接口（无插件系统）。

### 权限：内置 `beforeTool` 钩子

Project 的私有 `createHooks()` 创建一个纯 `HarnessHooks`，并把权限的 `beforeTool` 决策完整注册到
其中。回调执行时读取 Project 当前的 `UserInteraction`，因此 UI 延迟绑定不会要求重建 Harness。
Bash permission 策略分为 allow、ask、deny：ask 通过
`UserInteraction.select(["Allow once", "Always allow", "Deny"])` 请求外部回答；hard deny 在 Hook
内直接拒绝。没有 UI 时，`NoUserInteraction` 对需要批准的请求采用安全拒绝策略。

规范 Project 目录是默认受信任目录。`read_file`、`write_file`、`edit_file` 和 `glob` 的目标位于
外部目录时，Hook 用同样的三个选项询问；`Allow once` 只允许当前调用，`Always allow` 把目录规则
保存在 Project 的内存 `approved` 中，直至该 Project 生命周期结束。目录规则覆盖目录本身及其后代，
不覆盖名称前缀相似的兄弟目录。交互缺失、交互抛错或返回无效选项时，需要批准的工作都拒绝。

Session cwd 的归属和 Tool 访问授权是两个边界：相对 cwd 从 Project 目录解析，现存的绝对目录即使
位于 Project 外也可成为 Session cwd。Bash Tool Call 先批准外部 cwd，再进入 command 的
allow/ask/deny 分类；若目录被拒绝，就不分类命令。hard deny 优先于命令记忆规则，不能由
`Always allow` 覆盖。

Tool 的 `resolveToolPath()` 及各 Tool 本体只负责按 Session cwd 解析目标和执行，不嵌入访问策略；
Project 私有 `beforeTool` Hook 在执行前集中授权。该治理降低误操作风险，但不是文件系统沙箱或
shell 沙箱。

## 5. UI：共享命令语言、CLI 与 OpenTUI

`src/ui/` 只提供无终端依赖的命令语言：`UI_COMMANDS` 是 slash token、说明和 action 的规范列表，
`parseInput` 把一行输入解析为 `UiAction`
（prompt / new-session / switch-session / switch-model / help / exit / command-error）。
命令行实现位于 `src/ui/cli/`，全屏 TUI 位于 `src/ui/tui/`；两者都只通过
`ApplicationRuntime` 驱动应用。core 与 coding-agent 不导入任何 UI 层。

```ts
async function runCli(
  runtime: ApplicationRuntime,
  options: RunCliOptions,
): Promise<void>;
```

`RunCliOptions` 只包含 display、错误报告和 I/O 注入选项。`runCli()` 创建 readline、`Renderer` 与
`CliInteractions`，通过 Runtime 绑定 Interaction，并在返回前取消订阅、移除 SIGINT listener、关闭
readline；它不关闭 ApplicationRuntime，也不公开 lifecycle handle。

`runCli()` 是线性 Session 循环：一次只读一个 Prompt，`await harness.prompt(text)` 期间不再读第二个
普通 Prompt；Permission 提问发生在 `prompt()` 内部，通过同一 question 函数。命令只在字符 0 位置
匹配精确 slash token（`/new`、`/session`、`/model`、`/help`、`/exit`）；其他输入原样作为 Prompt。

`Renderer` 把 Session 历史与 `HarnessEvent` 投影到终端（thinking 默认可见、tool 事实默认
compact）；readline 负责回显当前用户输入。
`CliInteractions` 实现 `UserInteraction` 端口，把 `select`/`confirm`/`input` 映射到 readline
question 函数。Run 取消中止交互提问并传播，普通取消返回中性值。SIGINT 在 `current.isRunning` 时
调用 `current.abort()`；没有 Run 时留给 readline 自身的输入取消。Session 或模型切换失败时保留旧
Harness、订阅和模型。

`runCli()` 通过注入的 `reportError` 回调报告捕获的错误，不接触 Config 或凭据。

### OpenTUI React TUI

`kea` 默认启动 OpenTUI React alternate-screen TUI；`kea --ui cli` 永久保留上述 readline
界面，`--ui tui` 可显式选择默认模式。模式只在进程启动时决定，不写入 Config、Project 或
Session，也不能在进程内切换。Kea 没有增加公共 `ApplicationUi`、`TuiUi`、UI factory 或 registry。

TUI 的唯一生产入口是
`runTui(applicationRuntime, { thinking, toolDetails, redact })`。它括住一次 renderer/React 生命周期：
创建 alternate screen、挂载 `TuiApp`、处理中止与退出、卸载 React、销毁 renderer，并在返回前结清
已中止的 Prompt。它只在 TUI 分支动态 import，因此 CLI 模式不加载 OpenTUI native renderer。
两个具体 UI 都在内部创建并通过 ApplicationRuntime 绑定自己的 Interaction；`main` 只选择入口。

`TuiApp` 订阅 ApplicationRuntime，把现有 `HarnessEvent` delta 投影为本地渲染状态；
`turn-end.message` 与 `toolResults` 是最终权威值。Session 新建或切换由发起操作的 workflow 显式读取
快照，因为 Runtime 迁移 Harness 订阅时不发布 Session 替换事件。`tui-state.ts` 的 reducer 只保存
history、pending user、live Turn、Run、Session、底部 panel 和 notice 等渲染投影，不成为领域状态
权威。

`tui-app.tsx` 保留 Runtime 订阅、命令 workflow、Interaction 绑定和键盘协调；React 展示按实际职责
分布在 `components/welcome-screen.tsx`、`components/transcript.tsx`、
`components/bottom-panel.tsx` 和 `components/tui-footer.tsx`。空 Session 使用居中的欢迎页；第一次
Prompt 进入 `pendingUser` 后立即切换为 ScrollBox transcript 与底部 panel 的会话布局。
空闲 composer 输入 `/` 时，bottom panel 在不夺取输入焦点的前提下展示 `UI_COMMANDS`，后续输入按
slash token 前缀过滤；Up/Down 选择、Enter 执行、Escape 只关闭建议并保留输入。

`TuiInteractions` 实现 Project 接受的 `UserInteraction` 端口，同时只允许一个 pending request，
传播 Run abort，并在关闭时以中性值结清普通请求。Session/模型选择复用底部 panel 的视觉表达，但
由 TUI workflow 直接调用 Runtime/Project，不反向调用自己的 UserInteraction。TUI 支持与 CLI
相同的五个 slash command、Prompt、流式 text/thinking、Tool、权限、Session、模型、帮助、取消和
退出语义。

具体布局、投影和生命周期理由保存在
`docs/superpowers/specs/2026-08-24-opentui-tui-design.md`；当前实现状态以本文和 Accepted ADR 为准。

## 6. 启动层与 main.ts：组合根

`coding-agent/cli` 与 `coding-agent/config` 提供无长期状态的启动能力：`cli/args.ts`（argv
解析，返回 `diagnostics` 而非抛错）、`cli/project-directory.ts`（启动目录 → Git 根 → 规范目录）、
`config/config.ts`（唯一 Config 与 `loadConfig` 引导入口）、`config/defaults.ts`、
`config/schema.ts`（读取、解析与校验）和 `config/templates.ts`（用户配置模板）。这些模块只被
`main.ts` 和测试导入，不依赖 UI 或 Coding Agent 的领域内部组件。

### Config 与 loadConfig

`Config` 是唯一的应用设置实体，按优先级分层加载：内建默认值 < `~/.kea/config.json` <
`<project>/.kea/config.json` < `--config` 文件 < CLI 直接覆盖（`--verbose`）。每个普通配置源
独立验证后才合并；普通源拒绝 credential 字段（`apiKey`/`token`/`secret`/`password`）。凭据只来自
`~/.kea/auth.json`，在所有普通源之后加载。跨字段验证顺序：至少一个 provider → 每个 provider 的
`protocol` 为三者之一、`models` 非空 → `defaultModel` 必填且必须引用已配置 provider 并列出其
`models` 中的模型 → 启用 provider 的 auth key 非空。

`Config.load` 是纯加载：显式 `keaHome`、不建模板。应用引导入口 `loadConfig` 计算 `keaHome`
（默认 `~/.kea`）、补建缺失模板、对 created 文件打印 `<path>: created`，再转调 `Config.load`，
并返回 `{ config, keaHome }` 供 `createApplicationRuntime()` 使用；该工厂在内部打开或创建
Project。

`Config` 保持 Provider 凭据私有（`#providers`），公开 `models`、`defaultModel`、
`runtimeProviders()`、`maxTurns`、`toolTimeoutSeconds`、`thinking`、`toolDetails`、`verbose`
和 `redact()`。`redact()` 把所有已加载的非空 API key 替换为 `[REDACTED]`；顶层错误与 verbose
日志经它输出。

### 启动顺序

1. `parseArgs()` 解析 argv，参数错误进 `diagnostics`；UI 缺省为 `tui`，只接受 `--ui tui` 与
   `--ui cli`；
2. TUI 模式立即检查 stdin/stdout 是否为交互终端；失败时提示 `--ui cli` 并返回，不解析目录、不建
   Config 模板，也不创建 Runtime；
3. `resolveProjectDirectory()` 得到规范 Project 目录；
4. `loadConfig()` 计算 `keaHome`、补建用户配置模板（独占创建，绝不覆盖，只打印 `created`），
   再按上述顺序加载并验证，返回 `{ config, keaHome }`；
5. `createApplicationRuntime()` 创建 ModelRuntime，打开或创建 Project，并按 `kea -c` 恢复最新
   Session 或创建新的内存 Session（首条 Prompt 时持久化），最后返回持有初始 Harness 的
   ApplicationRuntime；
6. CLI 分支动态 import 并调用 `runCli()`；TUI 分支动态 import 并调用 `runTui()`。两个具体 UI
   都在内部创建并绑定自己的 Interaction，并在返回前清理自己的 UI 资源；
7. UI 生命周期错误在 Config 仍可用时经 `redact()` 报告；
8. 外层 `finally` 幂等关闭 ApplicationRuntime，解除长期订阅并把 Project 恢复为新的
   `NoUserInteraction`。

生产启动绝不调用 dotenv，也绝不从 `process.env` 读取 Provider 凭据。

### 交付与运行时

Bun 1.3.7 统一负责依赖安装、package scripts、TypeScript 源测试和生产应用运行；`bun.lock` 是
根包唯一锁文件。兼容的 `node:*` import 指向 Bun compatibility API，不表示支持 Node runtime。
Kea 没有把 Bun 包装成领域级 runtime abstraction：Session、AgentHarness、Project、
ApplicationRuntime 和 UserInteraction 的所有权不依赖交付工具。

TypeScript 仍是生产编译器：`bun --bun tsc -p tsconfig.build.json` 只把 `src/` 中的 TS/TSX 发射到
`dist/`，测试由 `bun:test` 直接执行，不产生 `dist/tests/`。
`dist/src/main.js` 保留
`#!/usr/bin/env bun` shebang，并作为 `kea` bin 的生产 JavaScript 入口。

本地全局分发必须先 `bun pm pack`，再从 tarball 执行 `bun install -g`；Bun 1.3.7 的
`bun install -g .` 不支持本项目。GitHub CI 固定 Bun 1.3.7，并在 Windows、Ubuntu 上依次
执行 frozen install、typecheck、source tests、production build、dist verification 和 isolated
global-package verification；GitLab CI 执行同一命令图。macOS 不属于 Kea 的支持或发布门平台。

正常卸载命令是 `bun remove -g kea-agent`。在 Windows 的隔离自定义 `BUN_INSTALL_BIN` 验证环境
中，Bun 1.3.7 可重复出现包目录与 global manifest 已删除而 `kea.exe`/`kea.bunx` 仍残留（nested
bin 也如此）。`verify:global` 先断言包状态已删除，再只清理它在精确 disposable `mkdtemp` bin 中
预先发现的 launcher artifact。这是隔离验证器的 workaround，不推断远程 registry 或默认全局
目录的行为。

## 7. 公共入口

- `src/core/ai/index.ts`：AI 消息、模型、流和显式 Provider 工厂；
- `src/core/harness/index.ts`：`runAgentLoop`、`AgentTool`/`AgentToolRegistry`、`AgentHarness`、
  `HarnessEvent`/`HarnessEventBus`、`HarnessHooks`/`HookName`/`HookContext`/`PreToolDecision`、
  `Session`、`SessionRepository`、Session 元数据和错误、`AgentRunIdentity` 与事件/钩子契约；
- `src/coding-agent/index.ts`：`ApplicationRuntime`、`createApplicationRuntime`、
  `CreateApplicationRuntimeOptions`、`NoUserInteraction`、`ProjectError`、`Project`/`ProjectInfo`、
  `UserInteraction`/`InteractionOptions`；
- `src/ui/index.ts`：`parseInput`、`UiAction`（无终端依赖的命令语言）；
- `src/ui/cli/index.ts`：`runCli`/`RunCliOptions`、`CliInteractions`、`Renderer`（命令行实现）；
- `src/ui/tui/run-tui.tsx`：OpenTUI React 的具体生产入口（只由 `main` 动态导入，不从公共 barrel
  再导出）；
- `src/index.ts`：汇总以上入口和通用 workspace helpers。

`coding-agent/cli` 与 `coding-agent/config` 保持应用内部：args、Config、模板创建和目录发现只由
`main.ts` 与测试导入。具体内置 Tool/hook factory、Bash policy 和各 Tool 的 details 类型都是内部
实现。

## 8. 边界约束

- `ai` 不依赖 `harness`；
- `harness` 不依赖 `coding-agent` 或 `ui`；agent-loop、Tool、观察事件与控制钩子同属本包；
- `harness` 不依赖具体 coding Tool 或 UI；
- `coding-agent` 的领域内部组件（project/tools/hooks/interaction）不依赖 `src/ui` 或
  `coding-agent/cli`、`coding-agent/config`，只定义 `UserInteraction` 端口；
- `coding-agent/cli` 与 `coding-agent/config` 不依赖 UI，也不依赖 Coding Agent 的领域内部组件；
  main 从 Config 取出 UI 需要的值传给 UI；
- `SessionRepository` 管理 Session 集合，`AgentHarness` 只绑定一份 Session；
- UI 通过 `ApplicationRuntime.subscribe()` 观察当前 Harness；Runtime 保存底层 Harness 订阅，并在
  成功替换当前 Harness 后迁移它。控制钩子通过 `harness.hooks.on()` 注册；权限回调由 Project
  私有装配，UI 和 ApplicationRuntime 都不修改 Hook 内部；
- 观察事件只通知已发生的事实，控制钩子负责提交前控制；
- `main.ts` 是唯一连接配置/provider 输入、ApplicationRuntime 和具体 UI 的应用入口；
  `createApplicationRuntime()` 负责 Project 和初始 Harness 的生产构造；Config 是唯一应用设置实体。
