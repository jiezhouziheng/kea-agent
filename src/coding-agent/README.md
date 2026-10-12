# coding-agent

coding-agent 把可复用的 Agent Harness 组合成 Kea 产品。这里负责项目、Session、内置工具、权限策略、模型配置和应用运行时；具体 CLI/TUI 渲染属于 ui 层。

## 入口

生产代码通过 createApplicationRuntime(options) 创建应用。该工厂负责：

- 打开或创建 Project。
- 根据启动参数创建或恢复初始 Session。
- 用 Project 和初始 AgentHarness 构造 ApplicationRuntime。

main 不直接编排 Project、Session 和 Harness 的创建流程。

## 核心对象

### ApplicationRuntime

ApplicationRuntime 是 UI 面向的应用运行时边界。

它负责当前 AgentHarness、创建新 Session、切换 Session、跨 Harness 切换保持事件订阅，以及把 UserInteraction 绑定请求委托给 Project。它不实现权限策略，不创建 Hooks，也不保存 UserInteraction。

### Project

Project 表示一个持久项目及其项目范围能力。

它负责 ProjectInfo、SessionRepository、模型配置、Harness 构造、项目级授权状态和当前 UserInteraction。Project 默认使用 NoUserInteraction，并通过私有 createHooks() 把权限策略装配进每个 Harness。

### AgentHarness

AgentHarness 是一次可 Prompt 的 Agent Session 执行实体。它拥有 Agent loop 所需的 Session、工具注册表、事件总线和纯 HarnessHooks，但不知道应用当前选择或具体 UI。

### UserInteraction

UserInteraction 是内核向外部请求 select、confirm 和 input 的反向端口。CLI/TUI 提供实现；没有 UI 时使用 NoUserInteraction 的默认策略。

## 交互绑定

```text
UI
  -> ApplicationRuntime.bindUserInteraction(interaction)
  -> Project.bindUserInteraction(interaction)
  -> private permission Hook reads Project.interaction when invoked
```

绑定不写入 HarnessHooks，也不需要在 Session 切换时迁移。ApplicationRuntime 关闭时把 Project 恢复为 NoUserInteraction。

## Hooks 与工具装配

HarnessHooks 只提供通用 Hook 注册和调用机制。

Project 的私有 createHooks() 集中注册 Kea 的权限 Hook，因为它依赖 projectDirectory、approved 和可变 UserInteraction。createBuiltinToolRegistry() 仍是独立工厂，因为它只依赖稳定的显式构造参数。两者不要求形式对称，避免为了外观把一段行为拆散到多个文件。

