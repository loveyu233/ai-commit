# AI Commit

一个最小可用的 VS Code 插件：

- 点击命令后自动读取当前工作区的 `git diff --cached` 和 `git diff`
- 将变更内容发送给 OpenAI 兼容接口
- 生成一条 commit message
- 自动回填到 Source Control 的提交输入框

## 配置

- `aiCommit.baseUrl`
- `aiCommit.apiKey`
- `aiCommit.modelId`
- `aiCommit.language`
- `aiCommit.maxDiffChars`
- `aiCommit.stageAllBeforeDiff`
- `aiCommit.timeoutMs`
- `aiCommit.messageStyle`

## 开发

```bash
npm install
npm run compile
```

按 `F5` 启动扩展开发宿主进行调试。
