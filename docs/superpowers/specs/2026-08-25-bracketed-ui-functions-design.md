# CLI/TUI 括号化运行函数设计

## 状态

设计已实施。

## 背景

Kea 当前有两种 UI 生命周期表达：

- `CliUi` 是类，公开 `interactions`、`run()` 和 `close()`；`main` 创建实例、绑定
  `ui.interactions`，再运行和关闭。
- TUI 公开 `runTui(runtime, options): Promise<void>`；它在一次调用内创建、运行和销毁
  OpenTUI/React，`TuiApp` 在内部创建并绑定 `TuiInteractions`。

两个 UI 都只运行一次，进程不支持 UI 切换，也没有外部消费者需要在运行期间控制 UI。公开的
生命周期对象没有提供额外产品能力。UI 创建和 Interaction 绑定属于具体 UI 的实现细节，可以由
各自的运行函数封装；`main` 只需要选择具体 UI，并在 UI 返回后关闭 `ApplicationRuntime`。

本设计改变 ADR-0004 中“CLI 保持类形态，不重构为 `runCli()`”的决定。实施时必须新增 ADR-0005
取代该部分决定，而不是静默修改 ADR-0004 的历史理由。

## 决定

两个具体 UI 都使用括号化异步函数：

```ts
async function runCli(
  runtime: ApplicationRuntime,
  options: RunCliOptions,
): Promise<void>;

async function runTui(
  runtime: ApplicationRuntime,
  options: RunTuiOptions,
): Promise<void>;
```

“括号化”表示函数返回前完成自己创建的所有 UI 资源清理。两个函数内部创建并通过
`ApplicationRuntime.bindUserInteraction()` 绑定自己的 Interaction。它们不关闭 Runtime；
`main` 继续在外层 `finally` 中关闭 Runtime，由此把 Project 恢复为 `NoUserInteraction`。

不增加 `ApplicationUi`、UI factory、lifecycle handle、registry、manager 或 controller。

## CLI

删除 `CliUi` 类，将 `src/ui/cli/cli-ui.ts` 替换为 `src/ui/cli/run-cli.ts`。

`runCli()` 使用局部变量和闭包保存现有 CLI 状态：

- readline；
- `Renderer`；
- `CliInteractions`；
- Runtime 订阅取消函数；
- SIGINT handler；
- Session、模型和 numbered selection workflow。

执行顺序：

1. 创建 readline、Renderer 和 `CliInteractions`；
2. `runtime.bindUserInteraction(interactions)`；
3. 注册 SIGINT；
4. 修复初始模型；
5. 订阅当前 Harness、渲染 Session，并进入现有线性 Prompt 循环；
6. `/exit`、EOF、初始模型取消或异常使循环结束；
7. `finally` 移除 SIGINT、取消订阅并关闭 readline；
8. 返回调用方。

Prompt、Session、模型、帮助、权限、错误报告和取消语义不变。函数内部不创建 context 对象来模拟
原来的 `this`；只保留必要的局部闭包。

`src/ui/cli/index.ts` 继续作为公开入口，导出：

```ts
export { runCli } from "./run-cli.js";
export type { RunCliOptions } from "./run-cli.js";
export { CliInteractions } from "./cli-interactions.js";
export { Renderer } from "./renderer.js";
```

不再导出 `CliUi` 或 `CliUiOptions`。

## TUI

`runTui()` 的公开形状和 renderer/React cleanup 保持不变。`TuiApp` 继续在 UI 内部创建和绑定
`TuiInteractions`，effect cleanup 关闭 pending Interaction；`runTui()` 继续负责 renderer、React
root、进程信号和活动 Prompt 的结清。

本次不移动 TUI Interaction 到 `main`，不增加 TUI handle，也不改变 HarnessEvent 或 reducer。

## main

`main` 只选择并调用具体函数：

```ts
if (args.ui === "cli") {
  await runCli(applicationRuntime, cliOptions);
} else {
  const { runTui } = await import("./ui/tui/run-tui.js");
  await runTui(applicationRuntime, tuiOptions);
}
```

CLI 与 TUI 都在各自分支动态 import，确保只加载启动参数明确选择的具体 UI；`--ui cli` 不加载
OpenTUI native dependencies。
UI 错误仍在 Config 可用的作用域内脱敏，Runtime 仍由唯一的外层 `finally` 关闭。

## 测试迁移

- `tests/ui/cli/cli-ui.test.ts` 重命名为 `run-cli.test.ts`，直接调用 `runCli()`；
- 测试 Project 捕获内部绑定的 `UserInteraction`，权限路径不再读取公开 `ui.interactions`；
- 原 `close()` 幂等测试改为验证正常返回和异常返回都恰好关闭一次 readline、移除订阅和 SIGINT；
- full composition 直接调用 `runCli()`，不再手动 bind/close；
- import smoke 从 `CliUi` 改为 `runCli`；
- 保留全部 Prompt、Session、模型、权限、错误、EOF 和 SIGINT 行为测试；
- TUI 测试保持不变。

## 文档与 ADR

实施时：

- 新增 ADR-0005，接受两个具体 UI 的括号化函数边界；
- ADR-0005 只取代 ADR-0004 关于具体 UI lifecycle 形状和 CLI 类的部分，不改变默认 TUI、永久 CLI、
  Bun/OpenTUI、动态 import、ApplicationRuntime、UserInteraction 或 HarnessEvent 决定；
- 更新 ADR index 和 `docs/architecture.md` 的当前 UI/public entry/main 启动描述；
- 本文状态改为已实施。

## 完成标准

- `CliUi`、`CliUiOptions` 及其构造调用全部删除；
- `runCli()` 是公开、可直接测试的唯一 CLI 生产入口；
- 两个 UI 都在内部绑定自己的 Interaction，并在返回前清理自己创建的 UI 资源；
- `main` 不接触具体 Interaction 或 UI cleanup；
- CLI/TUI 行为测试、import smoke、main tests、typecheck 和 build 通过；
- ADR-0005、ADR index 和当前架构文档与代码一致。
