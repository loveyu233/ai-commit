import * as cp from "node:child_process";
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

type Config = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  language: "zh-CN" | "en";
  maxDiffChars: number;
  stageAllBeforeDiff: boolean;
  timeoutMs: number;
  messageStyle: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("AI Commit");
  outputChannel.appendLine("AI Commit 已激活。");

  const disposable = vscode.commands.registerCommand("aiCommit.generateCommitMessage", async (repositoryHint) => {
    await generateCommitMessage(repositoryHint);
  });

  context.subscriptions.push(disposable, outputChannel);
}

export function deactivate() {}

async function generateCommitMessage(repositoryHint?: unknown) {
  try {
    outputChannel?.appendLine("收到生成提交信息命令。");

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("AI Commit: 当前没有打开工作区。");
      return;
    }

    const config = getConfig();
    if (!config.apiKey.trim()) {
      vscode.window.showErrorMessage("AI Commit: 请先配置 aiCommit.apiKey。");
      return;
    }

    const repository = await resolveRepositoryContext(workspaceFolder.uri.fsPath, repositoryHint);
    if (!repository) {
      vscode.window.showErrorMessage("AI Commit: 未找到当前工作区对应的 Git 仓库。");
      return;
    }
    const repoPath = repository.rootUri.fsPath;
    const scmInputBox = repository.inputBox;
    outputChannel?.appendLine(`当前仓库: ${repoPath}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "AI Commit 正在生成提交信息",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: config.stageAllBeforeDiff ? "正在执行 git add . 并读取 diff..." : "正在读取 git diff..." });
        const diff = await buildGitDiff(repoPath, config);
        if (!diff.trim()) {
          throw new Error("当前没有检测到可提交的变更。");
        }
        outputChannel?.appendLine(`diff 长度: ${diff.length}`);

        progress.report({ message: "正在调用 AI 生成 commit message..." });
        const message = await requestCommitMessage(diff, config);
        const normalizedMessage = normalizeCommitMessage(message);
        if (!normalizedMessage) {
          throw new Error("AI 未返回有效的 commit message。");
        }

        scmInputBox.value = normalizedMessage;
        outputChannel?.appendLine(`生成结果: ${normalizedMessage}`);
        vscode.window.showInformationMessage("AI Commit: 已生成提交信息。");
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "生成提交信息失败。";
    outputChannel?.appendLine(`执行失败: ${message}`);
    if (error instanceof Error && error.stack) {
      outputChannel?.appendLine(error.stack);
    }
    vscode.window.showErrorMessage(`AI Commit: ${message}`);
  }
}

function getConfig(): Config {
  const config = vscode.workspace.getConfiguration("aiCommit");
  return {
    baseUrl: config.get("baseUrl", "https://api.openai.com/v1"),
    apiKey: config.get("apiKey", ""),
    modelId: config.get("modelId", "gpt-4o-mini"),
    language: config.get("language", "zh-CN"),
    maxDiffChars: config.get("maxDiffChars", 12000),
    stageAllBeforeDiff: config.get("stageAllBeforeDiff", true),
    timeoutMs: config.get("timeoutMs", 30000),
    messageStyle: config.get(
      "messageStyle",
      "请输出一条简洁、准确、可直接提交的 Conventional Commits 风格 commit message，只返回提交信息本身，不要解释，不要代码块，以一个符合这次提交的git小表情为开头。"
    ),
  };
}

async function resolveRepositoryContext(
  workspacePath: string,
  repositoryHint?: unknown
): Promise<GitRepository | undefined> {
  const gitExtension = vscode.extensions.getExtension("vscode.git");
  if (!gitExtension) {
    outputChannel?.appendLine("未找到内置 Git 扩展 vscode.git。");
    return undefined;
  }

  const gitExports = await gitExtension.activate();
  const gitApi = gitExports?.getAPI?.(1);
  if (!gitApi) {
    outputChannel?.appendLine("无法获取 Git API。");
    return undefined;
  }
  const repositories = gitApi.repositories as GitRepository[];
  const hintedRepository = asGitRepository(repositoryHint);

  if (hintedRepository) {
    return hintedRepository;
  }

  return repositories.find((repository) => workspacePath.startsWith(repository.rootUri.fsPath))
    ?? repositories[0];
}

type GitRepository = {
  rootUri: vscode.Uri;
  inputBox: vscode.SourceControlInputBox;
};

function asGitRepository(value: unknown): GitRepository | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeRepository = value as Partial<GitRepository>;
  if (!maybeRepository.rootUri || !maybeRepository.inputBox) {
    return undefined;
  }

  return maybeRepository as GitRepository;
}

async function buildGitDiff(repoPath: string, config: Config): Promise<string> {
  if (config.stageAllBeforeDiff) {
    outputChannel?.appendLine("按配置执行 git add .");
    await runGitCommand(repoPath, ["add", "."]);
  }

  const stagedDiff = await runGitCommand(repoPath, ["diff", "--cached", "--no-ext-diff", "--submodule=diff"]);
  const unstagedDiff = await runGitCommand(repoPath, ["diff", "--no-ext-diff", "--submodule=diff"]);

  const sections = [
    stagedDiff.trim() ? `# Staged Changes\n${stagedDiff.trim()}` : "",
    unstagedDiff.trim() ? `# Unstaged Changes\n${unstagedDiff.trim()}` : "",
  ].filter(Boolean);

  return sections.join("\n\n").trim();
}

async function runGitCommand(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile("git", args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function requestCommitMessage(diff: string, config: Config): Promise<string> {
  const truncatedDiff = truncateText(diff, config.maxDiffChars);
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      temperature: 0.2,
      stream: true,
      messages: buildMessages(truncatedDiff, config),
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI 接口请求失败，状态码 ${response.status}：${body || "无响应内容"}`);
  }

  const streamMessage = await readStreamedMessage(response);
  if (streamMessage.trim()) {
    return streamMessage.trim();
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return extractMessageContent(data).trim();
}

function buildMessages(diff: string, config: Config) {
  const languageInstruction = config.language === "zh-CN"
    ? "请使用简体中文输出。"
    : "Please output in English.";
  const styleInstruction = config.messageStyle.trim()
    || "请输出一条简洁、准确、可直接提交的 Conventional Commits 风格 commit message，只返回提交信息本身，不要解释，不要代码块，以一个符合这次提交的git小表情为开头。";

  return [
    {
      role: "system",
      content: [
        "你是资深工程师，擅长根据 git diff 生成高质量提交信息。",
        languageInstruction,
        styleInstruction,
        "如果变更包含多个点，优先概括主要改动，保持信息准确、可读、可直接提交。",
      ].join(" "),
    },
    {
      role: "user",
      content: `请根据下面的 git diff 生成提交信息：\n\n${diff}`,
    },
  ];
}

function extractMessageContent(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  return readContentText(content);
}

async function readStreamedMessage(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const decoder = new TextDecoder("utf-8");
  const reader = response.body.getReader();
  let pending = "";
  let result = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        const chunk = JSON.parse(payload) as ChatCompletionStreamChunk;
        const deltaContent = chunk.choices?.[0]?.delta?.content;
        const messageContent = chunk.choices?.[0]?.message?.content;
        result += readContentText(deltaContent) || readContentText(messageContent);
      } catch (error) {
        outputChannel?.appendLine(`解析流式响应失败: ${payload}`);
        if (error instanceof Error) {
          outputChannel?.appendLine(error.message);
        }
      }
    }
  }

  return result.trim();
}

function readContentText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text || "")
      .join("")
      .trim();
  }

  return "";
}

function normalizeCommitMessage(message: string): string {
  return message
    .replace(/^```[\w-]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[diff 已截断，总长度超出限制]`;
}
