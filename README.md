# AI Commit

`AI Commit` 是一个面向日常 Git 提交场景的 VS Code 插件。它会读取当前工作区的变更，调用 OpenAI 兼容接口生成可直接提交的 commit message，并自动回填到 Source Control 输入框。

## 功能特性

- 支持命令面板和 Source Control 标题栏一键生成 commit message
- 支持 OpenAI 兼容接口，自定义 `baseUrl`、`modelId`、`apiKey`
- 支持自定义 AI 输出风格，例如 Conventional Commits、Gitmoji 或团队内部规范
- 可选在生成 diff 前先执行 `git add .`，默认开启，适合包含未跟踪文件的初始化场景
- 兼容流式响应接口
- 生成结果自动写入 VS Code Source Control 提交输入框

## 使用方式

1. 在 VS Code 设置中配置以下项目：

- `aiCommit.baseUrl`
- `aiCommit.apiKey`
- `aiCommit.modelId`
- `aiCommit.messageStyle`

2. 打开一个 Git 仓库。
3. 通过以下任一方式触发生成：

- 命令面板执行 `AI Commit: 生成提交信息`
- Source Control 视图标题栏点击 `AI Commit` 按钮

4. 插件会读取变更并把生成结果回填到提交输入框。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `aiCommit.baseUrl` | `string` | `https://api.openai.com/v1` | OpenAI 兼容接口基础地址 |
| `aiCommit.apiKey` | `string` | `""` | OpenAI 兼容接口 API Key |
| `aiCommit.modelId` | `string` | `gpt-4o-mini` | 生成 commit message 使用的模型 ID |
| `aiCommit.language` | `string` | `zh-CN` | 输出语言，可选 `zh-CN`、`en` |
| `aiCommit.maxDiffChars` | `number` | `12000` | 发送给模型的 diff 最大长度 |
| `aiCommit.stageAllBeforeDiff` | `boolean` | `true` | 生成 diff 前是否先执行 `git add .` |
| `aiCommit.timeoutMs` | `number` | `30000` | AI 接口请求超时，单位毫秒 |
| `aiCommit.messageStyle` | `string` | Gitmoji + Conventional Commits 风格提示词 | 自定义 commit message 输出风格 |

## 示例配置

```json
{
  "aiCommit.baseUrl": "https://api.openai.com/v1",
  "aiCommit.apiKey": "sk-xxx",
  "aiCommit.modelId": "gpt-4o-mini",
  "aiCommit.stageAllBeforeDiff": true,
  "aiCommit.messageStyle": "请输出一条简洁、准确、可直接提交的 Conventional Commits 风格 commit message，只返回提交信息本身，不要解释，不要代码块，以一个符合这次提交的git小表情为开头。"
}
```

## 隐私说明

- 插件会将当前工作区的 Git diff 发送到你配置的 AI 服务
- 请在确认代码内容允许外发的前提下使用
- `aiCommit.apiKey` 会保存在 VS Code 设置中

## 故障排查

- 如果点击后没有结果，请先执行 `Developer: Reload Window`
- 打开 `查看 -> 输出 -> AI Commit` 可以看到详细执行日志
- 如果服务端返回 `Stream must be set to true`，当前版本已经兼容该类流式接口

## 开发与打包

```bash
npm install
npm run compile
npm run package
```

按 `F5` 启动扩展开发宿主进行调试。
