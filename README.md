# Kea

Kea 是一个终端编码智能体学习项目，使用 TypeScript 和 Bun 编写。它可以调用模型、执行命令、读写文件，并在本地保存会话。

## 项目来源

Kea 的主要代码与设计参考 [Pi](https://github.com/earendil-works/pi)。TUI 使用 [OpenCode](https://github.com/anomalyco/opencode) 采用并由同一团队维护的 [OpenTUI](https://github.com/anomalyco/opentui) 框架。

## 功能概览

- 支持 OpenAI、Anthropic 和 Gemini 三种协议，也可通过 `baseUrl` 接入兼容服务。
- 内置 `bash`、文件读写、文件编辑、文件搜索和 Todo 工具。
- 自动保存会话，支持恢复、切换会话和切换模型。
- 默认使用 OpenTUI 全屏界面，同时保留 `--ui cli` 命令行界面。
- 目前暂时只支持 Windows 和 Linux

运行要求：

- Bun 1.3.7
- 至少一个模型服务商的 API Key
- Windows 需要 Git for Windows，供 Bash 工具使用；Linux 需要可用的 `bash`

## 快速开始

### 从源码运行

```bash
cd kea_agent
bun install --frozen-lockfile
bun run build
bun run start
```

修改源码后，需要重新执行 `bun run build`。

### 构建并全局安装

```bash
cd kea_agent
bun install --frozen-lockfile
bun run build
bun pm pack --filename kea-agent.tgz
```

Windows PowerShell 必须使用 tarball 的绝对路径。相对路径问题见 [oven-sh/bun#28208](https://github.com/oven-sh/bun/issues/28208)：

```powershell
$tarball = (Resolve-Path .\kea-agent.tgz).Path
bun install -g $tarball
```

安装后，在 Windows 的“环境变量”界面中打开“用户变量”里的 `Path`，加入 `%USERPROFILE%\.bun\bin`，然后重新打开终端：

```powershell
kea
```

Linux：

```bash
bun install -g "$PWD/kea-agent.tgz"
kea
```

卸载：

```bash
bun remove -g kea-agent
```

## 配置

首次运行会创建：

- `~/.kea/config.json`：模型和运行设置
- `~/.kea/auth.json`：API Key

`config.json` 最小示例：

```json
{
  "defaultModel": { "provider": "openai", "model": "your-model" },
  "providers": {
    "openai": {
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "models": ["your-model"]
    }
  }
}
```

`auth.json` 示例：

```json
{
  "providers": {
    "openai": { "apiKey": "your-api-key" }
  }
}
```

## 使用

```text
kea [directory] [-c] [--ui tui|cli] [--verbose] [--config <path>]
```

- `directory`：需要处理的项目目录，默认使用当前目录
- `-c`：恢复该项目最近一次会话
- `--ui tui|cli`：选择全屏 TUI 或命令行界面，默认是 TUI
- `--verbose`：显示启动诊断信息
- `--config <path>`：使用指定配置文件

交互命令：

- `/new`：新建会话
- `/session`：切换会话
- `/model`：切换模型
- `/help`：显示帮助
- `/exit`：退出 Kea

## 开发与验证

```bash
bun run typecheck
bun test
bun run build
bun run verify:dist
bun run verify:global
```

## 设计文档

- [项目术语](CONTEXT.md)
- [当前架构](docs/architecture.md)
- [架构决策记录](docs/adr/README.md)
