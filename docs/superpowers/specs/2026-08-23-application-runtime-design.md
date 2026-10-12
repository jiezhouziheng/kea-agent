# Application Runtime 设计

## 状态

已确认并完成实现。

Interaction 生命周期与所有权已由
`docs/superpowers/specs/2026-08-23-application-user-interaction-lifecycle-design.md`
取代；本文关于 Project 持有 `UserInteraction` 和旧组合顺序的描述不再适用。

本文设计 Kea 当前真实需要的应用运行时边界。项目只实现 CLI 和未来基于 OpenTUI 的 TUI，不为 WebUI、Desktop、RPC、远程客户端、多 Project 或多 Agent 并发预先建设抽象。

## 问题来源

原有 `CliUi` 同时负责两类工作：

- CLI 输入、命令解析、输出渲染、模型选择等界面交互。
- 保存当前 `AgentHarness`，替换 Harness，并在替换后迁移事件订阅。

未来 TUI 同样需要第二类生命周期逻辑。`ApplicationRuntime` 因此只提取“当前 Harness 的提交和订阅迁移”，不复制 Project 或 AgentHarness 已有能力。

## 现有概念

### Project

`Project` 是当前打开项目的聚合，继续管理项目范围内稳定存在并被多个 Session 复用的能力：

- `ProjectInfo`
- `SessionRepository`
- `ModelRuntime`、模型目录和默认模型
- Harness 创建与 Session 恢复
- 项目范围权限状态和 `UserInteraction`

`Project` 负责创建新 Harness、从 Session 恢复 Harness、列出 Session 和模型、检查模型配置并为 Harness 切换模型。

`Project` 不保存当前 Harness。当前 Harness 是应用进程中的活动选择，不是项目固有状态。

### AgentHarness

`AgentHarness` 是绑定一个具体 Session 的 Agent 执行运行时。它负责 prompt、abort、模型状态、Session 持久化和实时 `HarnessEvent`。

每个 Harness 独占自己的 `Events`、`Hooks` 和 `ToolRegistry`。当前没有 Project 级或 Session 外部事件机制。

`AgentHarness.subscribe()` 只订阅一个确定 Harness 的实时事件。

### Session

`Session` 是可持久化的会话数据和历史，不负责应用当前选择或 UI 订阅迁移。

## 关键约束：候选准备与激活提交分离

从已有 CLI 代码确认，恢复的 Session 可能保存了当前配置中已经不存在的模型。切换 Session 时必须先：

1. 由 Project 创建或恢复候选 Harness。
2. 由 UI 检查候选 Harness 的模型是否可用。
3. 必要时让用户选择替代模型。
4. 用户取消或修复失败时保留旧 Harness。
5. 准备成功后才提交当前 Harness 替换。

因此 Runtime 不能在 `newSession()` 或 `switchSession()` 内部直接创建并替换 Harness。那会在 UI 完成模型准备前改变当前状态，也会重复 Project 的创建职责。

最终采用两阶段设计：

```text
Project 创建候选 Harness
          |
          v
UI 准备候选 Harness 的模型
          |
          v
ApplicationRuntime.activate(candidate)
          |
          v
提交 current 并迁移长期监听器
```

## ApplicationRuntime 定义

`ApplicationRuntime` 表示一次 Kea 应用进程中，当前 Project 下唯一前台 Harness 的活动选择和替换生命周期。

它只负责：

- 持有并暴露一个 `Project`
- 持有并只读暴露当前 `AgentHarness`
- 原子提交一个已经准备完成的候选 Harness
- 成功激活后迁移长期 `HarnessEvent` 监听器
- 关闭时解除 Runtime 管理的监听器

它不负责：

- 创建或恢复 Harness
- 代理 prompt、abort 或模型切换
- 代理 Session 和模型列表查询
- 检查或修复候选 Harness 的模型
- 渲染历史或实时事件
- 保存 UI 组件状态
- 管理多个活动 Harness
- 重新定义 Harness 事件

## 总体结构

```text
main
  -> CliUi / TuiApp
    -> ApplicationRuntime
      -> Project
        -> AgentHarness
          -> Session
```

`main` 是唯一组合根。它创建 Project、初始 Harness 和 ApplicationRuntime，再把 Runtime 注入 UI。`main` 负责关闭 UI 和 Runtime。

## 公共接口

```ts
class ApplicationRuntime {
  readonly project: Project;

  constructor(project: Project, initialHarness: AgentHarness);

  get current(): AgentHarness;

  activate(candidate: AgentHarness): void;
  subscribe(listener: Parameters<AgentHarness["subscribe"]>[0]): () => void;
  close(): void;
}
```

`current` 只读。UI 可以使用当前 Harness，但不能直接替换它。

Runtime 不提供 `newSession()`、`switchSession()`、`prompt()`、`abort()`、`switchModel()`、`listSessions()` 或 `listModels()`。

## UI 操作路径

普通 prompt 和 abort 每次读取当前 Harness：

```ts
await runtime.current.prompt(input);
runtime.current.abort();
```

Session 和模型查询继续使用 Project：

```ts
const sessions = await runtime.project.listSessions();
const models = await runtime.project.modelOptions();
await runtime.project.switchModel(runtime.current, selection);
```

新建或恢复 Session 使用两阶段激活：

```ts
const candidate = await runtime.project.createHarness();
// 或 runtime.project.createHarnessFromSession(sessionId)

if (await prepareCandidateModel(candidate)) {
  runtime.activate(candidate);
  renderSession(candidate);
}
```

候选创建、模型准备或用户选择失败时，不调用 `activate()`，因此当前 Harness 和订阅完全不变。

## activate 语义

`activate(candidate)` 必须：

1. 检查 Runtime 尚未关闭。
2. 检查当前 Harness 未运行。
3. 从旧 Harness 解除 Runtime 管理的全部监听器。
4. 将 `current` 替换为候选 Harness。
5. 将同一批监听器直接注册到候选 Harness。

当前 Harness 正在运行时，`activate()` 明确抛错。Runtime 不自动 abort，也不把旧任务转入后台。

候选 Harness 必须在调用前完成准备。Runtime 不知道模型选择、UI 取消或 Session 创建过程。

## subscribe 语义

`ApplicationRuntime.subscribe()` 不提供新事件类型，也不拥有第二个 EventBus。它保存监听器及其当前 Harness 退订函数，并把同一个监听器直接注册到当前 Harness。

- `AgentHarness.subscribe()` 绑定一个确定 Harness。
- `ApplicationRuntime.subscribe()` 绑定“当前 Harness”这个可替换位置。

Runtime 不包装 `HarnessEvent`，不添加 Session id，不重放历史事件，也不发出 Session 切换事件。

Runtime 返回的退订函数必须幂等，并从 Runtime 的长期监听器集合删除对应项。`close()` 必须幂等地解除全部 Runtime 订阅。UI 自己保存 Runtime 返回的退订函数，`ui.close()` 只关闭自己的监听和输入资源；组合根负责调用 `runtime.close()`。

## CLI 职责

`CliUi` 通过 Runtime 完成：

- 获取当前 Harness
- 提交候选 Harness 激活
- 建立跨 Harness 替换的长期实时事件监听

`CliUi` 继续负责：

- 输入循环、命令解析和 SIGINT
- 通过 Project 创建或恢复候选 Harness
- 检查并修复候选模型
- Session 和模型选择交互
- 实时事件、Session 标题和历史渲染
- 错误显示

`CliUi` 不再保存可写的当前 Harness，也不直接迁移 Harness 订阅。

## main 组合与生命周期

组合根使用两个不同含义的 Runtime：

- `modelRuntime` 是现有模型调用能力，注入 Project。
- `applicationRuntime` 是应用当前 Harness 生命周期，注入 UI。

```ts
const modelRuntime = createModelRuntime(...);
const project = await openOrCreateProject({ runtime: modelRuntime, ... });
const initial = await selectInitialHarness(project, continueFlag);
const applicationRuntime = new ApplicationRuntime(project, initial);

try {
  await ui.run(applicationRuntime);
} finally {
  ui.close();
  applicationRuntime.close();
}
```

命名区分两种 Runtime 的作用域，避免把模型执行能力和应用活动状态混淆。

## 错误处理

- 候选 Harness 创建失败由 Project 方法抛错，UI 使用现有 `reportError` 路径处理。
- 候选模型准备取消或失败时不调用 `activate()`，旧状态保持不变。
- 当前 Harness 运行时激活候选 Harness，`activate()` 明确抛错。
- Runtime 关闭后订阅或激活，方法明确抛错。
- 错误不转换为 `HarnessEvent`。

## 非目标

- 不支持多 Project 导航。
- 不支持后台、并行或缓存 Harness。
- 不支持 WebUI、Desktop、RPC 或远程客户端。
- 不引入 ApplicationEvent、RuntimeEvent 或额外 EventBus。
- 不引入 AgentClient、ProjectRuntime、Service 容器或 Harness Registry。
- 不实现或封装 OpenTUI。

## 验收标准

- `ApplicationRuntime` 只公开 `project`、`current`、`activate`、`subscribe` 和 `close`。
- Project 继续负责创建和恢复 Harness，不保存当前 Harness。
- `CliUi` 不保存可写的当前 Harness。
- prompt、abort 和模型切换始终作用于 `runtime.current`。
- 候选模型准备失败时旧 Harness 和旧订阅保持有效。
- 成功激活后 Runtime 监听器只接收新 Harness 的实时事件。
- 当前 Harness 运行时拒绝激活。
- `main` 创建 ApplicationRuntime，并在退出时关闭 UI 和 Runtime。
- 不存在新的事件类型、EventBus 或 Project/Harness 代理方法。
- 未来 TUI 可以复用相同 Runtime，但 Runtime 不依赖 OpenTUI。
