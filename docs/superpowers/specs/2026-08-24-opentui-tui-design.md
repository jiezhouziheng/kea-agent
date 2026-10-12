# OpenTUI React TUI 设计

## 状态

当前工作树已实现并通过本地功能、构建、dist 与隔离全局包验证；集成后的三平台 CI 与完整人工
交互烟测尚待确认，因此尚未关闭交付门。

本文定义 Kea 从 readline CLI 扩展为双 UI 产品的设计。当前产品默认启动 OpenTUI React 全屏
TUI，并永久保留现有 CLI 作为显式启动模式。

## 设计时基线

设计开始时代码只有 `CliUi`。`main.ts` 是唯一生产组合根：解析参数、加载 Config、创建
`ApplicationRuntime`、构造 `CliUi`、绑定 `CliInteractions`，最后依次关闭 UI 和 Runtime。

现有边界保持不变：

- `ApplicationRuntime` 是 UI 面向的应用边界，拥有当前 `AgentHarness`、Session 替换和订阅迁移；
- `Project` 拥有 Session、Harness 构造、模型目录、权限状态和当前 `UserInteraction`；
- `AgentHarness` 永久绑定一份 Session；
- `HarnessEvent` 是观察事实，`UserInteraction` 是 Coding Agent 向 UI 请求人类回答的反向端口；
- `src/ui/commands.ts` 提供 UI 无关的 `parseInput()` 与 `UiAction`；
- Bun 1.3.7、`tsc -> dist`、`bun:test` 和当前全局包交付边界已经由 ADR-0003 固定。

当前事件协议已经足够驱动 TUI，但存在必须由 UI 正确处理的事实：

- 事件只携带 `runId`，不携带 `sessionId`；
- `run-start` 和 `turn-start` 不携带用户 Prompt；
- 用户消息在 `beforePrompt` 后持久化，Session 标题随后生成，完成后才发布第一个 `turn-start`；
- `ApplicationRuntime.subscribe()` 会把订阅迁移到新 Harness，但不会发布 Session 替换事件；
- `turn-end` 携带最终完整 `message` 和 `toolResults`；
- Harness event listener 会按注册顺序被 await，因此 UI listener 不得等待 React 渲染。

## 目标

- `kea` 默认启动 OpenTUI React 全屏 TUI。
- `kea --ui cli` 永久提供当前 readline CLI。
- TUI 覆盖当前 CLI 的 Prompt、流式输出、thinking、Tool、权限、Session、模型、帮助、退出和取消。
- 保持 `ApplicationRuntime`、`Project`、`AgentHarness`、`HarnessEvent` 与 `UserInteraction` 的所有权和
  协议不变。
- 使用 OpenTUI 自带布局、输入、滚动、选择、Markdown 和测试能力。
- 保证所有退出和失败路径恢复终端，并且 CLI 模式不加载 OpenTUI native renderer。
- 初版保持直接、可测试，不建立为未来插件、并发或多窗口准备的 UI 框架。

## 非目标

- 不删除或降级现有 CLI。
- 不支持进程内 UI 切换，也不把 UI 模式写入 Config、Project 或 Session。
- 不增加 Prompt 队列、并发 Harness、后台任务或多个同时活动的 UI。
- 不增加 command palette、Provider onboarding、MCP/LSP 状态、git sidebar、diff、share、fork、
  compaction、插件 slot 或主题系统。
- 不改变 `HarnessEvent` 为累计消息快照，也不增加第二事件总线。
- 不引入 Redux、Zustand、React Testing Library、JSDOM、PTY 测试框架或额外 Markdown 库。
- 不改用 `bun build`、bundle、单文件可执行或 Node/npm fallback。
- 不在初版加入 delta buffer、FPS 调优、worker 或性能 benchmark；真实卡顿出现后再测量。

## 启动选择

现有 `Args` 增加一个内联字段：

```ts
readonly ui: "tui" | "cli";
```

`parseArgs()` 直接解析 `--ui <value>`：

- 缺省值为 `"tui"`；
- 接受 `--ui tui` 和 `--ui cli`；
- 缺值、重复或其他值进入现有 `diagnostics`；
- 不接受 `--ui=tui`、短别名或额外兼容拼写；
- 不增加 `parseUiMode()`。

当选择 TUI 时，`main` 在目录解析、模板创建、Config 加载和 Runtime 创建之前检查 stdin/stdout
是否为交互终端。检查失败时打印明确错误和 `use --ui cli` 提示，设置失败退出码并返回。TUI 初始化
失败也不自动回退到 CLI，因为自动回退会掩盖安装或终端问题并产生不可预测的界面选择。

UI 模式只在进程启动时决定。进程中不保存模式，不提供 `switchUi()`。

## TUI 对外边界

TUI 唯一生产入口是：

```ts
async function runTui(
  runtime: ApplicationRuntime,
  options: {
    readonly thinking: "hidden" | "visible";
    readonly toolDetails: "compact" | "full";
    readonly redact: (message: string) => string;
  },
): Promise<void>;
```

`runTui()` 表达一项括号化操作：创建全屏 TUI、运行到退出、完成清理后返回。它不返回 lifecycle
handle，也不导出 `TuiUi`、`ApplicationUi`、factory、registry、manager 或 controller。

选择这个函数边界的原因是 OpenTUI renderer 通过异步工厂创建，并且全屏应用只有一个合法生命
周期。类或 factory handle 都会向调用方暴露重复 `run()`、漏 `close()`、先关闭后运行等无效状态，
而当前没有第二个消费者需要这些控制面。

`main.ts` 继续拥有 `ApplicationRuntime` 并直接选择 UI。Config 已加载后，UI 生命周期错误必须在
Config 仍可用的作用域内捕获、脱敏并设置失败退出码，不能落到当前未脱敏的顶层兜底：

```ts
try {
  if (args.ui === "cli") {
    const ui = new CliUi(applicationRuntime, cliOptions);
    applicationRuntime.bindUserInteraction(ui.interactions);
    await ui.run().finally(() => ui.close());
  } else {
    const { runTui } = await import("./ui/tui/run-tui.js");
    await runTui(applicationRuntime, tuiOptions);
  }
} catch (error) {
  reportError(error);
  process.exitCode = 1;
} finally {
  applicationRuntime.close();
}
```

CLI 保持当前结构；不为形式对称增加 `runCli()`。TUI 分支使用动态 import，因此 `--ui cli` 不加载
OpenTUI 或 native 依赖。TUI 内部创建并通过 Runtime 绑定自己的 `TuiInteractions`，符合
ADR-0002；ADR 不要求绑定语句必须由 `main` 亲自执行。

## 生产模块

```text
src/ui/tui/
├── run-tui.tsx
├── tui-app.tsx
├── tui-state.ts
└── tui-interactions.ts
```

### `run-tui.tsx`

只负责 OpenTUI renderer、React root、退出 Promise、进程级 SIGINT 处理和资源清理。它通过一个
私有 callback 取得当前 Prompt Promise，以保证返回前结清该操作；这不是导出的 lifecycle handle。
它不执行 Session、模型或命令工作流。

### `tui-app.tsx`

React 应用根组件，负责：

- 订阅 `ApplicationRuntime`；
- 创建并绑定 `TuiInteractions`；
- 调用现有 `parseInput()`；
- 执行 Prompt、Session、模型、帮助、退出工作流；
- 把当前 Prompt Promise 交给 `runTui()` 的私有 tracker，并在结清时清除；
- 把 state 渲染为 transcript、底部 panel 和 footer；
- 处理键盘与焦点恢复。

初版的小型展示组件留在本文件，不预先创建 `components/`、`hooks/` 或 theme 目录。

### `tui-state.ts`

保存纯状态类型和 reducer。它不导入 React、OpenTUI、ApplicationRuntime 或 Project；调用方把
Harness 事件与显式快照转换为 reducer action。

这个模块是必要边界而不是预留抽象：当前事件投影必须处理有序 text/thinking/tool 块、临时用户
消息、最终消息收口、多个 Turn 和 Session 快照替换，并需要脱离真实终端做精确单元测试。

### `tui-interactions.ts`

`TuiInteractions` 实现现有 `UserInteraction`。它保存至多一个 pending resolver 和 AbortSignal
监听器；React state 只接收可渲染 request descriptor，不保存 Promise resolver。

不创建额外 store、controller、action executor 或第二事件总线。

## TUI 状态

TUI 只保存 Runtime/Session 的渲染投影，不成为领域状态权威：

```text
history             已提交的 AgentMessage[]
pendingUser         提交后、首次 turn-start 前的临时用户输入
liveTurn            当前 Turn 的有序 text/thinking/tool 展示块
run                 当前 runId、阶段和 completed/aborted/error 状态
session             id、title、model 和可取得的 cwd 快照
panel               composer、Session/模型选择、help 或 UserInteraction
notice              至多一条已脱敏通知
```

`history` 保留原始 `AgentMessage`，不建立第二种持久消息模型。`liveTurn` 只描述尚未由
`turn-end` 收口的流式内容。

Session cwd 不为 UI 新增 Harness getter。激活 Session 时，TUI 从 `Project.listSessions()` 返回的
`SessionMetadata` 按 `runtime.current.sessionId` 找到真实 cwd；数据尚未取得时 footer 不伪造 cwd。

## Prompt 与事件投影

### 提交 Prompt

1. composer 调用现有 `parseInput()`；空白 Prompt 与当前 CLI 一样被忽略；
2. 普通 Prompt 立即进入 `pendingUser`，composer 进入 busy，避免标题生成期间画面看似丢失输入；
3. 调用 `runtime.current.prompt(text)`；运行期间不接受第二个普通 Prompt；
4. `run-start` 记录 runId；
5. 第一个 `turn-start` 读取一次 `runtime.current.messages`、`title` 和当前模型，替换 history 并清除
   `pendingUser`。这一步取得经过 `beforePrompt` 后真正持久化的 user message 与新标题；
6. 后续 `turn-start` 只开始下一份 `liveTurn`，不重复读取完整 history。

若 Run 在第一个 `turn-start` 前完成、被取消或失败，`run-end` 再读取一次当前 Harness 快照，确定
临时用户消息是否实际持久化并清除残留。

### 流式块

text、thinking 和 Tool 必须按事件原始顺序显示：

- `text-start` / `thinking-start` 开始对应块；
- delta 追加到当前兼容块；即使缺少 start，也惰性创建块以容忍合法观察输入；
- Tool Call 以 `(runId, id)` 定位；start/delta 建立参数预览，最终 `tool-call` 用结构化 call 收口；
- Tool Result 更新对应 Tool 展示，并受 `toolDetails` compact/full 控制；
- `thinking === "hidden"` 时 reducer 仍能正确推进事件，但视图不显示 thinking 内容。

不在初版缓存多帧或按定时器批量 delta。Harness listener 只同步 dispatch action 并立即返回，不
等待 React frame。

### Turn 与 Run 收口

`turn-end.message` 和 `turn-end.toolResults` 是最终权威值。Reducer 将它们按持久顺序加入 history，
清除当前 `liveTurn`；不依赖自行拼接的 delta 生成最终消息。

`run-end` 只设置 completed/aborted/error、清理异常残留并恢复 composer。Prompt 失败以
`run-end(error)` 为唯一正常展示来源；随后 `prompt()` rejection 被消费，不再显示第二条相同错误。
若 `prompt()` 在任何 `run-start` 前同步拒绝，才由调用工作流显示一条 notice。

## Session 与模型工作流

### `/new`

调用 `runtime.newSession()`。成功后显式读取新 Harness 和 Session metadata 快照，并清空旧
history/transient。失败时 Runtime 保留旧 Harness 和订阅，TUI 只显示一条 notice。

### `/session`

调用 `runtime.project.listSessions()`，按现有 newest-first 顺序在底部 panel 展示；选择后调用
`runtime.switchSession(id)`。成功后显式替换快照，因为 Runtime 迁移订阅时不会发布 Session 更换
事件。取消或失败不改变当前画面。

### `/model`

使用 `runtime.project.modelOptions()`，保持当前 CLI 的两阶段 provider -> model 选择；成功后调用
`runtime.project.switchModel(runtime.current, selection)` 并显式刷新 model 快照。选择当前模型仍为
no-op。

初始 Harness 模型不在配置目录中时，TUI 在允许 Prompt 前打开修复选择；取消初始修复会退出。
`/new` 或 `/session` 后遇到无效模型时保留已经激活的新 Session，打开修复选择；若用户取消，
Prompt 保持禁用并显示 `use /model before prompting`。

## UserInteraction

Session/模型选择与 `UserInteraction` 可以复用同一底部选择视图，但不能复用端口语义：

- Session/模型是 TUI 主动控制应用的本地 workflow；
- `TuiInteractions` 只处理 Coding Agent -> UI 的反向请求；
- TUI 不调用自己的 `UserInteraction.select()` 来实现 `/session` 或 `/model`。

`TuiInteractions` 的行为：

- `select` 返回 0-based index，普通取消返回 `undefined`；
- `confirm` 普通取消返回 `false`；
- `input` 返回非空文本，普通取消返回 `undefined`；
- Run signal 已中止或随后中止时，Promise 以 signal 的原始 reason 拒绝；
- 第二个并发请求拒绝，权限层据此 fail closed；
- 关闭 TUI 时清理 Abort listener，并用中性值结清没有 Run abort 的 pending 请求。

当前生产权限只调用 `select`，但 TUI 必须完整实现已接受的 `UserInteraction` 端口，不为尚未使用的
`confirm`/`input` 增加额外产品入口。

## 布局

TUI 使用 OpenTUI 默认 alternate-screen 全屏模式，不使用 main-screen 或 split-footer。原终端
scrollback 在退出后恢复。

```text
transcript / empty state
  empty Session: KEA ASCII placeholder + session/model hint
  conversation: user / assistant / thinking / Tool facts

bottom slot
  composer OR Session/model/help/UserInteraction panel

footer
  cwd/session             provider/model · run state · /help
```

具体规则：

- 不建设永久 Header，不给整屏增加装饰边框；
- 空 Session 不创建 transcript ScrollBox，而是把 `KEA` ASCII 占位 Logo、composer 和快捷提示组成
  居中欢迎页；第一次 Prompt 提交进入 `pendingUser` 后立即切换到会话布局，`/new` 后重新出现；
- 鹦鹉 Logo 是后续独立视觉替换，当前占位不阻塞功能实现；
- user message 使用深色背景和左侧主色强调线；
- assistant 使用普通 OpenTUI Markdown，不做聊天气泡；
- thinking 弱化显示并遵循 hidden/visible 配置；
- Tool 事实沿用 compact/full 配置；
- assistant 可以显示已有 `model · latency`，不伪造 provider、cost 或 Thought duration；
- 会话 transcript 使用 ScrollBox；位于底部时跟随流式输出，用户向上滚动后不强制拉回；
- composer 使用 Textarea；运行中禁用第二个 Prompt；
- footer 只显示当前确实可取得的数据，不增加 git、MCP、LSP、插件或成本占位。

## 键盘行为

- Enter：提交 Prompt 或确认当前选择；
- Shift+Enter：在 composer 中换行；
- Up/Down、PageUp/PageDown、Home/End：选择或滚动当前聚焦区域；
- Escape：关闭 help、本地选择或普通可取消交互，并恢复 composer 焦点；
- Ctrl+C：请求退出 TUI；若 Run 正在进行，`runTui()` 的统一退出路径先中止当前 Harness；
- `/exit`：仅在空闲 composer 中退出 TUI。

Kea 不增加 Prompt queue。运行时 composer 可保留视觉位置，但不接收第二条 Prompt；Permission
请求出现时，底部 slot 切换为交互 panel。

## Renderer 生命周期

`runTui()` 创建 renderer 时使用 alternate-screen，并关闭 OpenTUI 默认 Ctrl+C 退出。当前
OpenTUI 要求自定义 Ctrl+C 时同时设置 `exitOnCtrlC: false` 并从 `exitSignals` 移除 `SIGINT`；其余
终止信号仍可触发 renderer cleanup。

移除 renderer 的 SIGINT 处理后，`runTui()` 必须安装自己的进程级 SIGINT listener。OpenTUI
解析出的 Ctrl+C 键请求退出；真正到达进程的 SIGINT 也走同一退出路径。两者都会先中止正在运行的
Harness。listener 在 cleanup 中移除，不能让信号绕过 Kea 的 finally。

`TuiApp` 启动 Prompt 时，把该 Promise 交给 `runTui()` 的一个闭包变量；不增加公共 handle、store
或 Runtime API。这样 renderer 被外部销毁或进程收到 SIGINT 时，`runTui()` 可以发出 abort、先恢复
终端，再等待正在进行的 Prompt settle。Promise rejection 被消费，因为正常错误已经由
`run-end(error)` 投影；`ApplicationRuntime.close()` 不得与仍在结清的 Harness 并发执行。

正常 `/exit` 解析退出 Promise；外部 renderer destroy 同样使等待结束。`finally` 按顺序执行：

1. 标记退出，保存当前 Prompt Promise；若当前 Harness 仍在运行，发出 abort；
2. `root.unmount()`，由 effect cleanup 关闭 pending interaction 和 Runtime 订阅；
3. 对尚未 destroyed 的 renderer 调用 `destroy()`，恢复 raw mode、alternate screen、监听器与
   native 资源；
4. 终端资源恢复后，移除 `runTui()` 安装的 SIGINT listener；
5. 等待保存的 Prompt Promise settle，并消费已经展示过的 rejection；
6. 返回 `main`；
7. `main` 在外层 finally 调用 `ApplicationRuntime.close()`，把 Project 恢复为
   `NoUserInteraction`。

SIGINT listener 必须保留到 renderer 销毁完成；否则 cleanup 窗口中的第二次 SIGINT 会恢复进程
默认行为，并可能在 raw mode 或 alternate screen 尚未恢复时直接终止。终端恢复后再移除 listener，
此时若被中止的 Prompt 永久不 settle，用户仍可以用第二次 SIGINT 强制结束进程而不破坏终端状态。

renderer 或 React root 初始化只清理已经成功创建的资源。初始化或生命周期错误在终端恢复后重新
抛给 `main`，不自动启动 CLI。

## 错误与脱敏

TUI 不导入 Config。`main` 注入纯 `redact(message)` 函数，以下字符串进入 React state 前统一脱敏：

- `run-end.errorMessage`；
- Session/模型/命令 workflow 捕获的错误；
- renderer 生命周期中可转成应用 notice 的错误。

TUI 不在 alternate screen 中直接 `console.error()`。可恢复的 action 错误显示一条 notice；初始化
或根生命周期错误在 cleanup 后向外抛出，由 `main` 使用同一 Config redaction 后打印并设置失败
退出码。

## 依赖与 TypeScript

新增直接生产依赖：

- `@opentui/core`：创建 native `CliRenderer` 和使用内置 renderables；
- `@opentui/react`：React reconciler、root、hooks 和 React 测试工具；
- `react`：React 19.2 compatible runtime。

新增 dev dependency：`@types/react`。实现时按根包现有策略选择并固定彼此兼容的精确发布版本，
由 `bun.lock` 记录完整依赖图；不把 React DevTools/WebSocket peers 声明为直接依赖，也不使用相关
功能。若 OpenTUI 发布包的 peer metadata 使 Bun 自动解析它们，则只允许它们作为传递依赖留在锁
文件中。

`tsconfig.json` 增加：

```json
{
  "jsx": "react-jsx",
  "jsxImportSource": "@opentui/react"
}
```

基础 typecheck include 增加 `src/**/*.tsx` 和 `tests/**/*.tsx`，build include 增加
`src/**/*.tsx`。继续使用 NodeNext、TypeScript、Bun 1.3.7 和 `tsc -> dist`；不引入 React DOM，
不改为 Bundler resolution 或 `bun build`。

OpenTUI core 带平台 native optional packages。完整验证必须覆盖现有 Windows、Ubuntu、macOS CI，
并验证 tarball/global install，而不能只在开发机运行 TSX。

## 测试

新增：

```text
tests/ui/tui/tui-state.test.ts
tests/ui/tui/tui-interactions.test.ts
tests/ui/tui/tui-app.test.tsx
```

### 状态测试

- text/thinking/tool 有序块与缺 start 的 delta；
- Tool start/delta/final/result 收口；
- pending user 在 first turn-start 与持久消息对齐；
- `turn-end` 使用最终 message/toolResults 替换 draft；
- 多 Turn 与 run completed/aborted/error；
- Session snapshot 替换清除旧 transient。

### Interaction 测试

- select/confirm/input 正常回答与普通取消；
- 已中止和随后中止传播 exact reason；
- 第二个并发请求拒绝；
- close 结清 Promise 并移除 listener。

### React/OpenTUI 测试

使用 `@opentui/react/test-utils` 的 `testRender()` 与 core testing renderer：

- 空 Session 字符帧包含 `KEA`、composer 和真实 footer 数据；
- 已有对话字符帧包含 user、assistant、thinking/Tool 和 composer；
- 一条 `/model` 或 permission 的完整键盘选择路径；
- Escape 恢复 composer focus；
- Ctrl+C 请求退出，并由 `runTui()` 中止 active Harness；
- Session 切换后显式替换快照；
- renderer destroy 触发 effect cleanup。

测试 teardown 必须 destroy renderer。异步渲染使用 `waitForFrame()`，不使用 sleep 猜测时机。不增加
JSDOM、React Testing Library、PTY 或 PNG snapshot。

### 启动与交付回归

- `parseArgs()` 默认值、两个合法值、缺值、重复和非法值；
- 非 TTY TUI 在创建 Runtime 前失败并提示 CLI；
- `--ui cli` 不加载 OpenTUI；
- 更新 `tests/main.test.ts`、`scripts/verify-dist.ts` 和 `scripts/verify-global.ts` 中依赖非 TTY
  bootstrap 的现有探针，使其显式传入 `--ui cli`；另加一个无参数启动在非 TTY 下提前失败的断言；
- import `main` 和 TUI module 不创建 renderer、不注册信号、不输出；
- 保留全部 CLI tests 和 full composition；
- 运行 typecheck、完整 source tests、build、`verify:dist`、`verify:global`；
- Windows Terminal 做一次 alternate-screen、Ctrl+C、`/exit` 和崩溃恢复人工 smoke；
- 三平台 CI 验证 native optional dependency 安装和全局 tarball。

## 实施顺序

1. 添加精确依赖和 TSX 编译配置，先验证 OpenTUI 在当前 Bun/tsc 交付路径工作；
2. 扩展 `parseArgs()` 和 main TTY/动态 import 分支。等价开发期间可以暂时让省略 `--ui` 仍选择
   CLI，但必须允许显式 `--ui tui` 做集成验证；这是实现分支的过渡状态，不是本文定义的目标协议；
3. 实现并测试 `TuiInteractions`；
4. 实现 `tui-state` reducer 和事件收口测试；
5. 实现 `TuiApp` 的 transcript、composer、命令 workflow、选择 panel 与错误 notice；
6. 实现 `runTui()` 生命周期和 cleanup；
7. 完成 CLI 等价、import/build/global/三平台验证与 Windows 人工 smoke；
8. 最后把 `parseArgs()` 的无参数默认值切到 TUI，保留 `--ui cli`，并删除过渡默认行为；
9. 把本文状态改为已实施，更新 `docs/architecture.md` 的当前启动顺序和 ADR 实施状态。

每一步都不得通过公共 `ApplicationUi`、新 Runtime facade 或核心事件改造来提前解决尚未出现的
重复。

## 考虑过的方案

### `TuiUi` 类或 `createTui()` handle

可实现与 CLI 近似的 `interactions/run/close` 形状，但 OpenTUI renderer 异步初始化且全屏 TUI 只有
一段有效生命周期。公开 handle 会增加无效调用顺序，当前没有独立消费者需要它，因此拒绝。

### 公共 `ApplicationUi`

CLI 与 TUI 当前只有两个由 `main` 直接选择的实现，没有 UI registry、插件或多窗口宿主。共同接口
只会为形式对称命名一个不存在的新责任，因此拒绝。

### 同时重构 CLI 为 `runCli()`

能让 main 分支形状一致，但不会改善 readline CLI 的行为或测试，只扩大回归面，因此拒绝。

### OpenTUI Solid binding

Solid 是可用且被其他项目采用的绑定，但 Kea 已选择团队更熟悉、生态更成熟的 React。当前 TUI 不
需要 Solid 特有能力，因此采用 `@opentui/react`。

### 修改 HarnessEvent 为累计快照

会扩大核心协议、让每个 delta 携带不断增长的消息，并把纯展示需求推入 Harness。现有 delta +
`turn-end` 最终消息已经提供完整语义，因此拒绝。

### OpenTUI main-screen/inline 模式

Kea 的目标布局是固定 transcript、底部 composer/panel 和 footer 的完整应用，alternate screen 是
更直接的表达。CLI 已承担 scrollback-native 线性界面，因此 TUI 不再模拟第二种 inline UI。

### TUI 失败自动回退 CLI

会把 native 安装、TTY 或初始化问题伪装成另一个界面，并使自动化调用难以判断实际启动模式，因此
拒绝。用户必须显式使用 `--ui cli`。

## 完成标准

- 无参数 `kea` 在交互终端进入全屏 OpenTUI React 界面；
- `kea --ui cli` 保持现有 CLI 行为且不加载 OpenTUI；
- TUI 支持现有五个 slash command、Prompt、流式 text/thinking、Tool、权限和 Ctrl+C 退出；
- 新建/切换 Session、模型修复和失败回滚与当前 Runtime/CLI 语义一致；
- 用户输入、最终消息、标题、模型和 Session 切换不会因事件缺口重复或丢失；
- `/exit`、Ctrl+C、进程级 SIGINT、其他 renderer 终止信号、初始化失败和测试 teardown 都恢复终端，
  且 `runTui()` 返回前已结清被中止的 Prompt；
- 所有展示错误在进入 TUI state 前脱敏，Prompt 错误只显示一次；
- 不存在 `ApplicationUi`、`TuiUi`、UI factory、全局 store 或第二事件总线；
- TUI reducer、Interaction、字符帧和键盘路径测试通过，全部 CLI 回归保留；
- typecheck、source tests、build、dist/global verification 和三平台 CI 通过；
- ADR-0004、ADR index、`docs/architecture.md` 与最终代码同步。

## 参考

- [OpenTUI renderer](https://opentui.com/docs/core-concepts/renderer/)
- [OpenTUI lifecycle](https://opentui.com/docs/core-concepts/lifecycle/)
- [OpenTUI React package](https://github.com/anomalyco/opentui/tree/main/packages/react)
- [OpenTUI React root](https://github.com/anomalyco/opentui/blob/main/packages/react/src/reconciler/renderer.ts)
- [OpenTUI React test utilities](https://github.com/anomalyco/opentui/blob/main/packages/react/src/test-utils.ts)
- [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/)
- [OpenTUI Textarea](https://opentui.com/docs/components/textarea/)
- [OpenTUI Markdown](https://opentui.com/docs/components/markdown/)
