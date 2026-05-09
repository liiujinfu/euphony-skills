# Euphony Skills

[English](README.md) | [简体中文](README_CN.md)

为 Codex 和 CodeBuddy 安装本地 Euphony 会话查看 skill。

这个仓库包含两个独立 skill，并提供一个 npm 安装器：

- `skills/codex-euphony`：用 OpenAI Euphony 打开本地 Codex 会话 JSONL。
- `skills/codebuddy-euphony`：把本地 CodeBuddy 会话 JSONL 转成 Euphony 兼容格式后打开。

每个 skill 目录都是自包含的，也可以按路径单独安装。推荐使用 npm CLI，因为它能统一处理 Codex 和 CodeBuddy 两种宿主。

## 环境要求

- Node.js 18 或更高版本。
- `git`，skill 首次拉取 Euphony 运行时 checkout 时使用。
- `corepack`，用于执行 Euphony 的 `pnpm install`。
- macOS、Linux 或 Windows，并支持本地浏览器打开命令。

安装器本身不会安装 Euphony 依赖；对应 skill 会在第一次启动 Euphony 时按需安装。

## 快速安装

发布到 npm 后，可以这样安装：

```bash
npx @jefferylau/euphony-skills install codex
npx @jefferylau/euphony-skills install codebuddy
npx @jefferylau/euphony-skills install all
```

替换已有安装：

```bash
npx @jefferylau/euphony-skills install all --force
```

卸载已安装的 skill：

```bash
npx @jefferylau/euphony-skills uninstall all
```

检查本机状态：

```bash
npx @jefferylau/euphony-skills doctor
```

安装后需要重启 Codex 或 CodeBuddy，让宿主重新加载 skill。

## 本地 Checkout 安装

从本地 clone 安装：

```bash
git clone https://github.com/liiujinfu/euphony-skills.git
cd euphony-skills
node bin/euphony-skills.mjs install all --force
```

本地开发时可以使用软链接安装，这样修改仓库里的代码会立即生效：

```bash
node bin/euphony-skills.mjs install all --force --link
```

普通用户建议使用默认复制安装，不要加 `--link`。

## 安装位置

Codex 安装到：

```text
${CODEX_HOME:-~/.codex}/skills/codex-euphony
```

CodeBuddy 安装到：

```text
${CODEBUDDY_HOME:-~/.codebuddy}/skills/codebuddy-euphony
```

需要时可以覆盖宿主 home 目录：

```bash
CODEX_HOME=/custom/.codex npx @jefferylau/euphony-skills install codex
CODEBUDDY_HOME=/custom/.codebuddy npx @jefferylau/euphony-skills install codebuddy
```

## CLI 参考

```bash
euphony-skills install codex [--force] [--link]
euphony-skills install codebuddy [--force] [--link]
euphony-skills install all [--force] [--link]
euphony-skills uninstall codex
euphony-skills uninstall codebuddy
euphony-skills uninstall all
euphony-skills doctor
```

参数：

- `--force`：替换已有安装。
- `--link`：从宿主 skill 目录创建到当前 checkout 的软链接，只建议开发时使用。

## 使用方式

安装并重启宿主后，可以直接让助手用 Euphony 打开最新会话。

Codex 示例：

```text
Use codex-euphony to open the latest Codex session.
Open this Codex conversation in Euphony.
```

CodeBuddy 示例：

```text
Use codebuddy-euphony to open the latest CodeBuddy session.
Open this CodeBuddy conversation in Euphony.
```

也可以直接运行脚本。

Codex：

```bash
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs open
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs status
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs stop
```

CodeBuddy：

```bash
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs status
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

## 运行时行为

安装器只复制或链接 skill 目录，不会复制会话日志、生成的 JSONL、本地缓存或 Euphony checkout。

运行时：

- Codex 使用 `${CODEX_HOME:-~/.codex}/cache/euphony`。
- CodeBuddy 使用 `${CODEBUDDY_HOME:-~/.codebuddy}/cache/euphony`。
- 如果缓存被删除，下一次需要 Euphony 时会自动重建。
- 本地 Euphony 服务绑定到 `127.0.0.1`。
- 默认端口是 `3000`。
- Codex staging 在 macOS/Linux 默认使用软链接，在 Windows 默认复制文件。设置 `EUPHONY_STAGE_MODE=copy` 可以在所有平台强制使用快照复制。
- 后台服务通过 Euphony cache 下的 pid 文件跟踪，所以 `stop` 只会停止同一个 skill 脚本启动的服务。

如果 `3000` 端口已被占用，可以换端口：

```bash
EUPHONY_PORT=3001 node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs open
EUPHONY_PORT=3001 ~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs open
```

Windows PowerShell 示例：

```powershell
$env:EUPHONY_PORT = "3001"
node "$env:USERPROFILE\.codex\skills\codex-euphony\scripts\codex-euphony.mjs" open
```

## 隐私

会话 JSONL 可能包含提示词、路径、工具输出，以及对话中出现过的敏感信息。skill 只会通过本地 `127.0.0.1` Euphony 实例提供临时 staged 数据。

不要提交生成的会话文件、staged JSONL 输出、`.env` 文件或 Euphony 缓存目录。这个仓库的 npm 包内容只包含 CLI、README、LICENSE 和 skill 源码。

## 排错

如果宿主没有识别到 skill，安装后先重启 Codex 或 CodeBuddy。

如果安装提示 skill 已存在，使用 `--force`：

```bash
npx @jefferylau/euphony-skills install codebuddy --force
```

如果 Euphony 启动失败，先检查依赖和安装状态：

```bash
npx @jefferylau/euphony-skills doctor
```

如果 `npm` 报 cache 权限错误，可以使用临时 cache，或修复 npm cache 目录权限：

```bash
npm_config_cache=/tmp/euphony-skills-npm-cache npx @jefferylau/euphony-skills doctor
```

如果有多个 Euphony 服务在跑，停止对应服务或换端口：

```bash
node ~/.codex/skills/codex-euphony/scripts/codex-euphony.mjs stop
~/.codebuddy/skills/codebuddy-euphony/scripts/codebuddy-euphony.mjs stop
```

## 开发

运行检查：

```bash
npm run check
```

不影响真实 home 目录的安装测试：

```bash
CODEX_HOME=/tmp/euphony-test-codex \
CODEBUDDY_HOME=/tmp/euphony-test-codebuddy \
node bin/euphony-skills.mjs install all --force
```

测试软链接安装：

```bash
CODEX_HOME=/tmp/euphony-test-codex \
CODEBUDDY_HOME=/tmp/euphony-test-codebuddy \
node bin/euphony-skills.mjs install all --force --link
```
