# ApplicationRuntime 与 UserInteraction 生命周期设计

状态：已接受

## 背景

Kea 的权限判断发生在 Agent Harness 内部，但真正的询问能力由 CLI 等外部 UI 提供。启动时，ApplicationRuntime 必须先于 UI 创建；UI 创建后才可以把自己的 UserInteraction 实现绑定进来。

旧设计把交互状态藏在一种特殊的 HarnessHooks 子类中，并由 ApplicationRuntime 在 Harness 切换时识别、绑定和迁移。这使 Hooks 同时承担回调机制、交互状态容器和应用生命周期适配三种职责，也让 Runtime 必须了解 Harness 的内部装配方式。

## 决策

UserInteraction 由 Project 持有。

- Project 创建时默认使用 NoUserInteraction。
- ApplicationRuntime.bindUserInteraction() 只负责把应用级绑定请求委托给 Project。
- Project.bindUserInteraction() 替换当前 UserInteraction。
- Project 私有 createHooks() 完成权限 Hook 的全部装配。
- 权限 Hook 在每次执行时读取 Project 当前的 UserInteraction，而不是捕获创建 Harness 时的旧值。
- ApplicationRuntime 切换 Harness 时不迁移 UserInteraction。
- ApplicationRuntime.close() 将 Project 恢复为新的 NoUserInteraction。
- HarnessHooks 保持纯粹，只负责注册和调用 Hook。
- UI 不通过 ApplicationRuntime 调用 select、confirm 或 input；这些方法是内核向 UI 发起交互的反向端口。

## 对象关系

```text
main
  |
  +-- createApplicationRuntime(options)
  |     |
  |     +-- Project
  |     |     +-- SessionRepository
  |     |     +-- project configuration
  |     |     +-- approved permissions
  |     |     +-- current UserInteraction
  |     |     +-- private createHooks()
  |     |
  |     +-- initial AgentHarness
  |     |
  |     +-- ApplicationRuntime
  |
  +-- CliUi(ApplicationRuntime)
        |
        +-- ApplicationRuntime.bindUserInteraction(CliUi.interactions)
```

## 权限调用链

```text
AgentHarness
  -> Agent loop / ToolRegistry
  -> HarnessHooks.beforeTool(...)
  -> Project.createHooks() 注册的权限回调
  -> decidePermission(...)
  -> Project 当前 UserInteraction
  -> CLI select / confirm / input
```

Hook 回调闭包持有 Project，而不是某次绑定时的 UserInteraction。因此 UI 在 Harness 创建后绑定，或在应用生命周期中替换交互实现，都不需要重建 Harness 和 Hooks。

## 职责边界

### HarnessHooks

只提供 Hook 注册、取消注册和按顺序调用。它不知道权限、Project、UI 或 UserInteraction。

### decidePermission

只实现权限策略。所有输入通过参数提供，不持有生命周期状态，也不负责创建 Hooks。

### Project

管理一个项目内的 Session、Harness 构造、项目配置、项目级授权状态和当前 UserInteraction。私有 createHooks() 是项目依赖进入 Harness 的组合根，权限 Hook 的完整装配逻辑集中在这里。

### ApplicationRuntime

管理应用当前 Harness、Session 切换和跨切换的 UI 事件订阅。它公开 bindUserInteraction() 作为应用边界，但不保存 UserInteraction，也不理解 Hook 内部结构。

### UI

依赖 ApplicationRuntime 操作当前 Harness，并实现 UserInteraction 供内核在需要授权或输入时反向调用。

## 为什么 Hooks 不再使用工厂

createBuiltinToolRegistry() 的依赖是 cwd 和超时等稳定显式值，因此它可以是独立纯工厂。

权限 Hooks 依赖 Project 的可变 UserInteraction、approved 权限和 projectDirectory。把这段逻辑拆成外部工厂和 Project 回调会让一个完整行为分散在两个位置；把 UserInteraction 作为创建参数又会捕获旧绑定。私有 Project.createHooks() 可以直接访问同一生命周期中的状态，并把完整权限装配保留在一个位置。

这里不追求 ToolRegistry 与 Hooks 的表面对称，而追求依赖和职责的对称：纯依赖使用纯工厂，项目生命周期依赖由 Project 私有装配。

## 构造方式

生产代码只有一个异步组合入口：

```ts
const runtime = await createApplicationRuntime(options);
const ui = new CliUi(runtime, options);
runtime.bindUserInteraction(ui.interactions);
await ui.run();
```

createApplicationRuntime() 负责打开 Project、选择或恢复初始 Session，并创建 ApplicationRuntime。ApplicationRuntime 构造函数保留给模块内部组合和轻量测试，不承担异步创建职责。

## 明确不采用的方案

- 不在 ApplicationRuntime 暴露 select、confirm、input。
- 不把 UserInteraction 放进 HookContext。
- 不让 Project.createHarness() 接收 UserInteraction。
- 不让 HarnessHooks 持有 UserInteraction。
- 不使用 CodingAgentHooks 子类或 instanceof 识别。
- 不在 Harness 切换时迁移交互绑定。
- 不为权限装配额外引入 ExtensionRunner 或 ApplicationContext。

