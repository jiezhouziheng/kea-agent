# Bun 运行时迁移设计

## 状态

设计已确认并完成实施。

本文只设计 Kea 从 Node/npm 迁移到 Bun 的交付工具链。Kea 已选择在后续 TUI 设计中采用
OpenTUI，但 OpenTUI 不在本次迁移中进入生产依赖或 UI 实现。

## 背景

Kea 当前使用 npm 管理依赖、Node.js 24 执行构建产物与 `node:test` 测试，并由 `tsc` 把
TypeScript 编译到 `dist/`。未来 TUI 已决定采用 OpenTUI，而 OpenTUI 以 Bun 为主要运行环境。

长期同时维护 Node 和 Bun 会产生两套锁文件、测试语义、CI 入口和运行时兼容承诺。Kea 当前架构
已经稳定，因此迁移应只改变交付工具链，不改动 `Session`、`AgentHarness`、`Project`、
`ApplicationRuntime` 或 `UserInteraction` 的职责。

2026-08-24 使用 `npm test` 重新建立的迁移前基线为 322 个 Node 测试：320 个通过，2 个按平台
条件跳过，0 个失败。直接让 Bun 执行现有 `node:test` 产物会失败，说明测试框架必须正式迁移到
`bun:test`，不能只替换启动命令。SPEC/PLAN 中更早的 331/333 是历史快照，不再是当前验收数字。

## 目标

- Bun 1.3.7 是根项目唯一的包管理器、脚本执行器、应用运行时和测试运行器。
- `tsc` 继续负责类型检查与生产 JavaScript 编译。
- 根项目只提交 `bun.lock`，不再提交或维护 npm 锁文件。
- Kea 继续产出 `dist/`，并支持通过 Bun 建立全局 `kea` 命令。
- 测试使用 Bun 原生方式直接运行 TypeScript。
- Windows、Linux 和 macOS 都进入迁移后的自动验证范围。
- OpenTUI 后续可以建立在同一 Bun 工具链上，而不需要再次迁移运行时。

## 非目标

- 本次不实现 OpenTUI；先前的可行性 spike 已在设计确认后删除。
- 本次不改用 `bun build`、单文件 bundle 或独立可执行文件。
- 本次不重构核心架构或引入 `BunRuntime` 等领域抽象。
- 本次不承诺 Node 运行兼容，也不保留 Node fallback。
- 本次不为了外观统一而重写所有兼容的 `node:*` 生产 API。
- 本次不批量把所有既有 `node:assert/strict` 断言改成 `expect`。

## 决策

### 工具职责

```text
package.json + bun.lock
          |
          | bun install
          v
   TypeScript 源码
          |
          | bun run build -> tsc
          v
    dist/**/*.js
          |
          | Bun Runtime
          v
       kea CLI
```

Bun 负责安装、脚本调度、测试和运行；`tsc` 是由 Bun 启动的编译工具。继续使用 `tsc` 不等于
继续使用 Node 运行时。

兼容性验证通过的 `node:fs`、`node:path`、`node:child_process`、`node:readline` 等模块说明符
可以保留，它们是 Bun 提供的 Node 兼容 API。是否支持 Node 由 package scripts、CI、shebang 和
发布说明决定，而不是由模块说明符的名字决定。

### 包管理与版本固定

- `package.json` 增加 `"packageManager": "bun@1.3.7"`。
- 删除 `engines.node`；README 和 CI 同样固定 Bun 1.3.7。
- Bun 从现有 npm 锁文件迁移依赖图并生成根目录 `bun.lock`。
- 完成依赖版本核对和冻结安装验证后删除根目录 `package-lock.json`。
- CI 和可重复安装统一使用 `bun install --frozen-lockfile`。
- 只有被实际依赖且理由明确的包才能进入 `trustedDependencies`；不得宽泛启用 lifecycle scripts。
- 根目录是当前唯一 package boundary，仓库中只保留一个 `bun.lock`。

### TypeScript 与生产构建

- `tsconfig.json` 检查 `src/` 和 `tests/`，显式提供 Bun 测试类型和 Bun 所兼容的 Node API 类型；
  `@types/node` 与 `moduleResolution: "NodeNext"` 是编译期契约，不是 Node 运行 fallback。
- 新增 `tsconfig.build.json`，只编译生产源码到 `dist/`，并保留 `rootDir: "."`，使 CLI 路径仍为
  `dist/src/main.js`。
- `bun run typecheck` 内部使用 `bun --bun tsc --noEmit`。`--bun` 强制覆盖 TypeScript CLI 自带
  的 Node shebang，保证编译器进程也由 Bun 启动。
- `bun run build` 先清理 `dist/`，再使用 `bun --bun tsc -p tsconfig.build.json` 构建。
- 清理脚本由 Bun 执行，不再调用 `node -e`。
- `dist/` 不包含测试文件。

本次保留 `tsc -> dist` 边界，避免把运行时迁移和 bundler 迁移合成一个问题。接入 OpenTUI 时，
再根据 TSX 和原生依赖的真实约束决定是否采用 `bun build`。

### Bun 原生测试

- 根目录新增 `bunfig.toml`，以 `[test] root = "tests"` 限定测试发现边界；裸 `bun test` 直接发现
  并执行 `tests/**/*.test.ts`，不会扫描其他目录。
- 测试定义从 `bun:test` 导入 `test`、`describe`、`expect` 等 API。
- Node 条件跳过写法改为 `test.skipIf()`。
- 动态 Node 子测试改为 `test.each()` 或声明期 `describe()`，不在运行中的测试内部注册测试。
- 新增或重写的断言优先使用 `bun:test` 的 `expect`。
- 既有 `node:assert/strict` 可以作为断言库保留；它不启动 Node。只有在语义清楚且不会扩大迁移
  风险时才改写为 `expect`。
- Bun 单进程运行暴露出的共享状态必须通过测试隔离修复，不能靠永久串行设置掩盖。
- `bun test` 在没有 `dist/` 的全新 checkout 中也必须独立成功。源码测试中的路径按测试文件当前
  `import.meta.url` 计算；现有 `tests/import-smoke.test.ts` 对 `main.ts` 的路径由编译产物语义改为
  源码语义。

测试数量的输出不要求与 Node 的 322 严格相同，因为两个 runner 对父子测试的计数可能不同；
每个既有行为案例、断言和平台跳过理由必须得到保留。

### 构建产物与全局 CLI

- `bin.kea` 继续指向 `dist/src/main.js`。
- 生产入口 shebang 改为 `#!/usr/bin/env bun`。
- `bun run start` 使用 Bun 执行构建产物。
- 源码单元测试不依赖 `dist/`；构建后由独立 `verify:dist` 命令验证 `dist/src/index.js` 和
  `dist/src/main.js` 的静默导入、入口执行与 `process.versions.bun`。
- `package.json.files` 限制 tarball 只包含运行所需的生产产物与包元数据，不发布源码测试、内部
  设计历史或 CI 文件。
- Kea 当前为 private 本地包。全局分发使用 `bun pm pack` 生成 tarball，再以
  `bun install -g <tarball>` 安装；未来发布到 registry 后才使用 `bun install -g kea-agent`。
- 不使用 `bun install -g .`：Bun 1.3.7 在当前 Windows 实测会发生 Bun 自身崩溃；`bun link -g`
  也存在生成断链包装器的问题。tarball 安装已在隔离全局目录中验证成功。
- `verify:global` 在隔离的 `BUN_INSTALL_GLOBAL_DIR`、`BUN_INSTALL_BIN` 和用户配置目录中完成
  打包、安装、执行与卸载，不污染开发者现有全局安装。无模型凭据启动时，以创建模板后按预期
  失败作为 CLI 已成功加载的证据，并同时断言入口由 Bun 执行。

### CI

GitHub Actions 删除 Node setup 和 npm cache，改用 `oven-sh/setup-bun` 并固定 Bun 1.3.7；现有
GitLab CI 同步改用 Bun，不能留下第二条 Node/npm CI 路径。

CI 使用 Windows、Ubuntu、macOS 矩阵，每个平台依次执行：

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun test`
4. `bun run build`
5. `bun run verify:dist`
6. `bun run verify:global`

Windows 可以继续跳过仅适用于 POSIX 权限或行为的两个测试；Ubuntu 和 macOS 必须执行它们。

## 迁移顺序

1. 保存当前 Node 测试基线。
2. 生成并核对根目录 `bun.lock`。
3. 调整 package scripts、Bun 类型环境和 TypeScript build config。
4. 把测试注册、参数化和条件跳过迁移到 `bun:test`，恢复完整行为覆盖。
5. 修改构建、启动、shebang 和子进程测试，使所有执行入口使用 Bun。
6. 验证模型 SDK、文件 API、子进程、Git/Git Bash、readline 与信号处理。
7. 删除 `package-lock.json` 和所有 Node/npm 执行入口。
8. 更新 GitHub 三平台 CI 和 GitLab CI，并验证 tarball 全局 CLI。
9. 同步 README、SPEC 当前要求、PLAN 当前目标、架构文档、ADR 及索引；SPEC_PROCESS 和
   AGENT_LOG 只追加迁移记录，不改写旧 Node/npm 历史。
10. 运行最终冻结安装、类型检查、构建、测试和静态回退检查。

迁移期间可以用当前 Node 测试结果定位行为差异，但这个基线只是一种临时诊断手段，不进入最终
脚本、CI 或支持矩阵。

## 失败处理

- Bun 兼容问题在使用该 API 的最窄边界内修复，不向核心模块扩散 Bun 专属抽象。
- 不通过删除断言、弱化期望或无条件跳过测试换取绿色结果。
- 不增加永久 Node fallback。如果关键行为无法由 Bun 正确实现，停止迁移并记录阻塞。
- 依赖 lifecycle script 必须逐包授权并记录原因。
- 保留工作区已有的 `/models` 漂移修复及回归测试；机械迁移测试导入时不得覆盖用户改动。
- 任何跨平台差异都显式进入测试或文档，不能只依赖开发机器行为。
- “无 Node/npm fallback”的静态检查只覆盖 Kea 的一等执行入口：package scripts、CI、README 和
  shebang。`node:*` 模块说明符、`@types/node`、依赖元数据和 GitHub Action 自身的宿主实现不算
  Kea 的 Node fallback。

## 考虑过的方案

### 永久同时支持 Node 和 Bun

这会保留两个运行时、两套测试语义和更大的支持矩阵，并让 OpenTUI 路径持续受到 Node 兼容承诺
约束，因此拒绝。

### Bun 只做包管理器，Node 继续运行

迁移成本最低，但没有为 OpenTUI 建立需要的 Bun 运行时，也无法消除双工具链，因此拒绝。

### 立即改用 `bun build`

能形成更集中的 Bun 工具链，但会同时引入 bundling、dynamic import、SDK 与未来原生依赖的
external 决策。本次没有足够收益，延后到 OpenTUI 集成时判断。

### 直接把 TypeScript 源码作为全局 bin

Bun 可以直接执行 TypeScript，但这会让发布包绑定源码布局并取消现有生产构建边界，因此拒绝。

## 完成标准

- 仓库只有根目录 `bun.lock`，没有 npm 锁文件。
- `bun install --frozen-lockfile`、`bun run typecheck`、`bun run build`、`bun test` 全部成功。
- `dist/` 只包含生产构建产物。
- 所有既有行为测试均保留，平台跳过仍有明确理由。
- 三个模型 SDK、子进程、文件系统、readline、信号和 import smoke tests 在 Bun 下通过。
- tarball 中只包含运行所需文件；`kea` 全局命令由 Bun 执行，隔离安装和卸载成功。
- package scripts、CI、README 和 shebang 中不存在 Node/npm 回退命令。
- Windows 本地验证通过，Windows、Ubuntu、macOS CI 定义一致。
- `docs/architecture.md`、Accepted ADR 与实际代码保持一致。

## 2026-08-24 实施证据

实施 commits 为 `e21b738`、`f2a3424`、`b2f8e1e`、`8d17a74`、`5295a75`、
`ae66210`、`7cc1a90`、`de2a83e`。在 `de2a83e` 上从 Windows 仓库根目录按顺序实际执行：

```powershell
bun --version
bun install --frozen-lockfile
bun run typecheck
bun run clean
bun test
if (Test-Path -LiteralPath dist) {
  throw "bun test must not create dist/"
}
bun run build
bun run verify:dist
bun run verify:global
```

观察结果为 Bun `1.3.7`；冻结安装报告
`Checked 54 installs across 74 packages (no changes)`；typecheck 与 clean 退出 0；源码测试报告
`326 total / 324 pass / 2 skip / 0 fail`、30 次 `expect()`、42 files，两个 skip 是已有 Windows
平台条件，随后 `dist/` 不存在断言退出 0；production build 退出 0；`verify:dist` 打印
`dist verification passed` 并退出 0；`verify:global` 退出 0。

`verify:global` 的证据仅来自它用 `mkdtemp` 创建的隔离 `BUN_INSTALL_GLOBAL_DIR`、
`BUN_INSTALL_BIN`、HOME 与 project：先 `bun pm pack --ignore-scripts`，从 tarball 全局安装，验证
包内容、Bun shebang、启动行为和 Bun 1.3.7 子进程，再卸载。Windows Bun 1.3.7 在这种自定义
隔离 bin（nested bin 也相同）中会出现 package directory 与 global manifest state 已删除，但
`kea.exe`/`kea.bunx` 仍残留；验证器先断言包和 manifest 已移除，再只删除它在精确 disposable
bin 中预先发现的 launcher artifacts。这不是默认全局目录或远程 registry 行为的观察结果。

没有 dependency lifecycle script 被加入 `trustedDependencies`；打包也显式使用
`--ignore-scripts`。OpenAI、Anthropic 与 Gemini 的 canonical adapter 测试均通过，没有出现要求
信任某个 lifecycle script 的 SDK 证据。

`.github/workflows/ci.yml` 已配置 Windows、Ubuntu、macOS 依次运行六条交付命令；
`.gitlab-ci.yml` 配置同一 Bun Linux 命令图。本节只把上述 Windows 执行记为本地实测，
Ubuntu/macOS GitHub jobs 是 configured-but-unobserved，需提交并 push 后以远程 CI 结果补充。

ADR 0003 仍为 `accepted`，ADR index 仍列出 Bun 是 Kea 唯一 runtime/toolchain；实施没有引入
永久 Node/npm fallback 或不同运行时，因此不需要 superseding ADR。
