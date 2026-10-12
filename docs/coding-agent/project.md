# Project

Project 是 coding-agent 中一个持久项目的领域对象和 Harness 组合边界。它不是全局 ApplicationRuntime，也不是 UI 控制器。

## 持有的状态

Project 持有：

- ProjectInfo 和规范化项目目录。
- SessionRepository。
- ModelRuntime、默认模型和可选模型。
- Harness 执行策略，例如 maxTurns 和工具超时。
- 项目级已批准权限。
- 当前 UserInteraction，初始值为 NoUserInteraction。

ApplicationRuntime 持有“当前选择了哪个 Harness”；Project 只负责创建或恢复属于该项目的 Harness。这样跨 Session 的 UI 状态与项目内部能力不会混在一起。

## UserInteraction 生命周期

Project 提供 bindUserInteraction(interaction)，供 ApplicationRuntime 委托应用级绑定。

Project 已创建的每个权限 Hook 都在执行时读取 this.interaction。因此：

- Project 和初始 Harness 可以在 UI 之前创建。
- UI 绑定后不需要重建初始 Harness。
- 新建或恢复 Session 不需要再次传递 UserInteraction。
- ApplicationRuntime 不需要接触 HarnessHooks。
- 关闭应用时可以统一恢复 NoUserInteraction。

UserInteraction 不作为 createHarness() 或 createHarnessFromSession() 的参数，也不放进 HookContext。它是 Project 组合生命周期中的依赖，不是单次 Tool 调用的数据。

## Session cwd 与外部目录权限

Project 目录是受信任目录。`createHarness()` 未提供 cwd 时使用 Project 目录；相对 cwd 从
Project 目录解析；现存的绝对 cwd 可以位于 Project 外。`createHarnessFromSession()` 同样接受
已持久化且仍存在的外部绝对 cwd。这一行为只决定 Session 工作目录，不自动授予外部文件或命令
访问权限。

Project 私有 `beforeTool` Hook 对每次调用做授权：

- `read_file`、`write_file`、`edit_file`、`glob` 的目标在 Project 外时询问
  `Allow once` / `Always allow` / `Deny`。
- `Always allow` 的目录规则只保存在当前 Project 的内存 `approved` 中，可供该 Project 的其他
  Session 复用；它覆盖目录本身和后代，不覆盖兄弟目录。
- Bash 在外部 Session cwd 中运行时，先询问 cwd 的目录权限；通过后才做命令 allow/ask/deny
  分类。hard deny 不会被已记住的命令或目录授权覆盖。
- 未绑定 UI 时 `NoUserInteraction` 安全拒绝需要批准的操作；交互失败和无效选择也拒绝。Run
  取消则继续传播取消，而不是伪装成用户拒绝。

Tool 路径解析只相对 Session cwd 得到目标，不承载策略。权限归 Project 组装的 Hook 所有；这些
规则是治理，不是文件系统或 shell 沙箱。

## Harness 构造

Project 的 buildHarness() 组合：

- 新建的内存 Session，或从存储恢复的持久 Session；新建 Session 在首条 Prompt 时持久化。
- ModelRuntime 和模型配置。
- createBuiltinToolRegistry() 创建的内置工具。
- createSystemPrompt() 创建的系统提示。
- 独立 HarnessEventBus。
- 私有 createHooks() 创建的 HarnessHooks。

createHooks() 在一个位置完成权限 Hook 的注册，并调用纯 decidePermission() 策略。该回调使用 projectDirectory、approved、HookContext 的 cwd/signal，以及 Project 当前 UserInteraction。

## 为什么 createHooks() 是私有方法

权限 Hook 依赖 Project 的可变生命周期状态。独立工厂若接收某次 UserInteraction，会让后续绑定失效；若接收 Project 回调，又会把一个权限行为拆到 Project 和工厂两个位置。

私有方法允许完整装配逻辑靠近其状态所有者，同时让 HarnessHooks 保持通用。它与 createBuiltinToolRegistry() 不必表面对称：工具工厂依赖稳定参数，权限 Hook 依赖 Project 当前状态。

## 不负责的内容

Project 不负责：

- UI 渲染和命令循环。
- 应用当前 Harness 的选择。
- 跨 Harness 迁移 UI 事件订阅。
- ApplicationRuntime 的关闭状态。
- HarnessHooks 的通用注册与调用协议。
- decidePermission() 内部的权限规则。
