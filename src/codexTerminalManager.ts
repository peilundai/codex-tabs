import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { readConfiguration } from "./configuration";
import {
  CODEX_SETUP_DOCS_URL,
  EXTENSION_NAME,
  OPEN_SETUP_DOCS_ACTION,
} from "./constants";
import {
  applyCommandLookup,
  immediateExitMessage,
  isImmediateFailure,
  lookupCodexCommand,
  missingCommandMessage,
} from "./launchDiagnostics";
import { planDropInterception } from "./dropInterception";
import {
  buildLaunchPlan,
  profileExitCommand,
  terminalEnvironment,
} from "./launch";
import { formatMentions, resourceFsPath } from "./pathMentions";
import { CodexPseudoterminal } from "./codexPseudoterminal";
import {
  buildBridgeLaunch,
  locatePythonWithPty,
  wrapProfileWithBridge,
} from "./pythonBridge";
import { sessionArguments, type SessionAction } from "./sessionLaunch";
import type {
  CwdMode,
  EditorKind,
  EditorRestore,
  ResourceTabSnapshot,
  WorkspaceFolderDescriptor,
} from "./types";
import { chooseWorkingDirectory } from "./workingDirectory";

interface CodexSession {
  terminal: vscode.Terminal;
  cwd?: string;
  viewColumn: number;
  lastUsed: number;
  openedAt: number;
  command: string;
  failureNotified?: boolean;
}

export class CodexTerminalManager implements vscode.Disposable {
  private readonly sessions = new Map<vscode.Terminal, CodexSession>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly reaper: ReturnType<typeof setInterval>;
  private sequence = 0;
  private pythonCache: string | null | undefined;
  private handlingTabMove = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.sessions.delete(terminal);
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.rememberActiveSession(terminal);
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.handleTabChanges(event).catch((error: unknown) => {
          this.reportError("Could not process the dropped editor", error, false);
        });
      }),
    );

    this.reaper = setInterval(() => this.disposeExitedTerminals(), 1_000);
    this.reaper.unref?.();
  }

  dispose(): void {
    clearInterval(this.reaper);
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const { terminal } of [...this.sessions.values()]) {
      if (vscode.window.terminals.includes(terminal)) {
        terminal.dispose();
      }
    }
    this.sessions.clear();
  }

  async open(): Promise<void> {
    const session = this.preferredSession();
    if (session) {
      this.reveal(session);
      return;
    }
    await this.createSession();
  }

  async newChat(): Promise<void> {
    await this.createSession();
  }

  async resumeChat(): Promise<void> {
    await this.createSession("resume");
  }

  async forkChat(): Promise<void> {
    await this.createSession("fork");
  }

  async insertPaths(uri?: vscode.Uri, selected?: readonly vscode.Uri[]): Promise<void> {
    const resources =
      selected && selected.length > 0
        ? selected
        : uri
          ? [uri]
          : this.activeResources();
    const paths = resources
      .map((resource) => resourceFsPath(resource))
      .filter((item): item is string => Boolean(item));
    await this.insertIntoSession(this.preferredSession(), paths);
  }

  private async createSession(action: SessionAction = "new"): Promise<void> {
    const configuration = readConfiguration(this.configurationResource());
    const args = sessionArguments(configuration.args, action);
    const lookup = lookupCodexCommand(
      configuration.command,
      args,
      configuration.launchMode,
      process.platform,
      process.env,
      isExistingFile,
    );
    if (lookup.status === "missing") {
      await this.reportMissingCommand(configuration.command);
      return;
    }

    const cwd = await this.resolveWorkingDirectory(configuration.cwdMode);
    if (cwd === "cancelled") {
      return;
    }

    const python = this.pythonWithPty();
    const launch = applyCommandLookup(
      buildLaunchPlan(
        {
          ...configuration,
          args,
        },
        process.platform,
        process.env,
      ),
      lookup,
    );
    const bridgeScript = this.context.asAbsolutePath("scripts/codex-pty-bridge.py");
    const bridge = python
      ? buildBridgeLaunch(launch, {
          python,
          bridgeScript,
          cwd,
          titleMaxLength: configuration.titleMaxLength,
        })
      : undefined;
    const viewColumn = this.targetViewColumn();
    const iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "codex-tab-icon-light.png",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "codex-tab-icon.png",
      ),
    };

    let terminal: vscode.Terminal;
    if (bridge) {
      terminal = vscode.window.createTerminal({
        name: EXTENSION_NAME,
        pty: new CodexPseudoterminal({
          ...bridge,
          cwd,
          environment: terminalEnvironment({
            ...process.env,
            PYTHONUNBUFFERED: "1",
          }),
          titleMaxLength: configuration.titleMaxLength,
        }),
        iconPath,
        isTransient: true,
        location: { viewColumn, preserveFocus: false },
      });
    } else {
      const options: vscode.TerminalOptions = {
        name: EXTENSION_NAME,
        cwd,
        iconPath,
        isTransient: true,
        env: { COLORTERM: "truecolor" },
        location: { viewColumn, preserveFocus: false },
      };
      if (launch.kind === "loginShell") {
        options.shellPath = launch.executable;
        options.shellArgs = [...launch.args];
      }
      terminal = vscode.window.createTerminal(options);
    }

    const session: CodexSession = {
      terminal,
      cwd,
      viewColumn,
      lastUsed: ++this.sequence,
      openedAt: Date.now(),
      command: configuration.command,
    };
    this.sessions.set(terminal, session);
    terminal.show(false);
    // `ViewColumn.Beside` is a placement sentinel (-2), not the concrete
    // column that VS Code creates. Rebind immediately after reveal so the
    // next chat reuses the resulting editor group even when activation events
    // are coalesced by a compatible editor.
    this.rememberActiveSession(terminal);

    if (launch.kind === "profile") {
      const command =
        python && process.platform !== "win32"
          ? wrapProfileWithBridge(launch.commandLine, {
              python,
              bridgeScript,
              cwd,
              titleMaxLength: configuration.titleMaxLength,
              shell:
                process.env.SHELL ||
                (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
            })
          : profileExitCommand(launch.commandLine, process.platform);
      terminal.sendText(command, true);
    }

    this.output.appendLine(
      `Opened Codex${action === "new" ? "" : ` ${action}`} chat in ${cwd ?? "the terminal default directory"}.`,
    );
  }

  private targetViewColumn(): vscode.ViewColumn {
    return this.preferredSession()?.viewColumn ?? vscode.ViewColumn.Beside;
  }

  private preferredSession(): CodexSession | undefined {
    this.pruneSessions();
    const active = vscode.window.activeTerminal;
    const activeSession = active ? this.sessions.get(active) : undefined;
    if (activeSession && this.isAlive(activeSession.terminal)) {
      return activeSession;
    }
    return [...this.sessions.values()]
      .filter((session) => this.isAlive(session.terminal))
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
  }

  private sessionInColumn(viewColumn: number): CodexSession | undefined {
    const active = vscode.window.activeTerminal;
    const activeSession = active ? this.sessions.get(active) : undefined;
    if (activeSession?.viewColumn === viewColumn && this.isAlive(activeSession.terminal)) {
      return activeSession;
    }
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.viewColumn === viewColumn && this.isAlive(session.terminal),
      )
      .sort((left, right) => right.lastUsed - left.lastUsed)[0];
  }

  private reveal(session: CodexSession): void {
    session.lastUsed = ++this.sequence;
    session.terminal.show(false);
  }

  private rememberActiveSession(terminal: vscode.Terminal | undefined): void {
    if (!terminal) {
      return;
    }
    const session = this.sessions.get(terminal);
    if (!session) {
      return;
    }
    session.lastUsed = ++this.sequence;
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    if (activeGroup.activeTab?.input instanceof vscode.TabInputTerminal) {
      session.viewColumn = activeGroup.viewColumn;
    }
  }

  private async insertIntoSession(
    session: CodexSession | undefined,
    paths: readonly string[],
  ): Promise<void> {
    if (!session) {
      void vscode.window.showInformationMessage("No Codex chat is open.");
      return;
    }
    if (paths.length === 0) {
      void vscode.window.showInformationMessage(
        "Select a file or folder in the workspace to insert.",
      );
      return;
    }
    const input = formatMentions(paths, session.cwd);
    if (!input) {
      return;
    }
    this.reveal(session);
    session.terminal.sendText(input, false);
  }

  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    if (this.handlingTabMove || event.opened.length === 0) {
      return;
    }
    this.rememberActiveSession(vscode.window.activeTerminal);
    const plan = planDropInterception(
      event.opened.map(tabSnapshot),
      event.closed.map(tabSnapshot),
      new Set([...this.sessions.values()].map((session) => session.viewColumn)),
    );
    if (!plan) {
      return;
    }
    const session = this.sessionInColumn(plan.destinationColumn);
    if (!session) {
      return;
    }
    const insert = formatMentions(plan.paths, session.cwd);
    if (!insert) {
      return;
    }

    const uris = new Map<string, vscode.Uri>();
    const tabsToClose: vscode.Tab[] = [];
    for (const tab of event.opened) {
      const uri = resourceUri(tab);
      if (!uri) {
        continue;
      }
      const key = uri.toString();
      uris.set(key, uri);
      if (plan.closeResourceKeys.includes(key)) {
        tabsToClose.push(tab);
      }
    }
    if (tabsToClose.length === 0) {
      return;
    }

    this.handlingTabMove = true;
    try {
      await vscode.window.tabGroups.close(tabsToClose, true);
      for (const restore of plan.restore) {
        const uri = uris.get(restore.resourceKey);
        if (uri) {
          await restoreEditor(uri, restore);
        }
      }
      this.reveal(session);
      session.terminal.sendText(insert, false);
    } finally {
      this.handlingTabMove = false;
    }
  }

  private activeResources(): readonly vscode.Uri[] {
    const activeEditor = vscode.window.activeTextEditor?.document.uri;
    if (activeEditor && resourceFsPath(activeEditor)) {
      return [activeEditor];
    }
    const uri = resourceUri(vscode.window.tabGroups.activeTabGroup.activeTab);
    return uri && resourceFsPath(uri) ? [uri] : [];
  }

  private async resolveWorkingDirectory(
    mode: CwdMode,
  ): Promise<string | undefined | "cancelled"> {
    const folders: WorkspaceFolderDescriptor[] = (
      vscode.workspace.workspaceFolders ?? []
    ).map((folder) => ({ name: folder.name, fsPath: folder.uri.fsPath }));
    const choice = chooseWorkingDirectory(folders, activeResourcePath(), mode);
    if (choice.kind === "unavailable") {
      void vscode.window.showWarningMessage(
        `${EXTENSION_NAME}: no workspace or home directory is available. The chat was not started.`,
      );
      return "cancelled";
    }
    if (choice.kind === "path") {
      return choice.fsPath;
    }
    const selected = await vscode.window.showQuickPick(
      choice.folders.map((folder) => ({
        label: folder.name,
        description: folder.fsPath,
        fsPath: folder.fsPath,
      })),
      { placeHolder: "Choose the workspace folder for this Codex chat" },
    );
    return selected?.fsPath ?? "cancelled";
  }

  private pythonWithPty(): string | undefined {
    if (this.pythonCache !== undefined) {
      return this.pythonCache ?? undefined;
    }
    const located = locatePythonWithPty({
      platform: process.platform,
      environment: process.env,
      exists: fs.existsSync,
      run: (executable, args, timeoutMilliseconds) =>
        spawnSync(executable, [...args], { timeout: timeoutMilliseconds }),
    });
    this.pythonCache = located ?? null;
    if (!located && process.platform !== "win32") {
      this.output.appendLine(
        "Python 3 with Unix PTY support was not found; advanced titles and modifier-drop rewriting are disabled.",
      );
    }
    return located;
  }

  private isAlive(terminal: vscode.Terminal): boolean {
    return vscode.window.terminals.includes(terminal) && !terminal.exitStatus;
  }

  private pruneSessions(): void {
    for (const terminal of this.sessions.keys()) {
      if (!vscode.window.terminals.includes(terminal)) {
        this.sessions.delete(terminal);
      }
    }
  }

  private disposeExitedTerminals(): void {
    for (const session of [...this.sessions.values()]) {
      const terminal = session.terminal;
      if (!vscode.window.terminals.includes(terminal) || !terminal.exitStatus) {
        continue;
      }
      const exitCode = terminal.exitStatus.code;
      if (isImmediateFailure(exitCode, Date.now() - session.openedAt)) {
        if (!session.failureNotified && typeof exitCode === "number") {
          session.failureNotified = true;
          this.notifyImmediateExit(session.command, exitCode);
        }
        continue;
      }
      terminal.dispose();
    }
  }

  private configurationResource(): vscode.Uri | undefined {
    const activeEditor = vscode.window.activeTextEditor?.document.uri;
    if (activeEditor && resourceFsPath(activeEditor)) {
      return activeEditor;
    }
    return resourceUri(vscode.window.tabGroups.activeTabGroup.activeTab);
  }

  private async reportMissingCommand(command: string): Promise<void> {
    const message = missingCommandMessage(command);
    this.output.appendLine(message);
    const choice = await vscode.window.showErrorMessage(
      message,
      OPEN_SETUP_DOCS_ACTION,
    );
    if (choice === OPEN_SETUP_DOCS_ACTION) {
      await vscode.env.openExternal(vscode.Uri.parse(CODEX_SETUP_DOCS_URL));
    }
  }

  private notifyImmediateExit(command: string, exitCode: number): void {
    const message = immediateExitMessage(command, exitCode);
    this.output.appendLine(message);
    void vscode.window
      .showErrorMessage(message, OPEN_SETUP_DOCS_ACTION)
      .then((choice) => {
        if (choice === OPEN_SETUP_DOCS_ACTION) {
          void vscode.env.openExternal(vscode.Uri.parse(CODEX_SETUP_DOCS_URL));
        }
      });
  }

  private reportError(context: string, error: unknown, notify: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`${context}: ${message}`);
    if (notify) {
      void vscode.window.showErrorMessage(`${context}: ${message}`);
    }
  }
}

function resourceUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputNotebook ||
    input instanceof vscode.TabInputCustom
  ) {
    return input.uri;
  }
  return undefined;
}

function editorKind(tab: vscode.Tab): EditorKind {
  if (tab.input instanceof vscode.TabInputNotebook) {
    return { kind: "notebook" };
  }
  if (tab.input instanceof vscode.TabInputCustom) {
    return { kind: "custom", viewType: tab.input.viewType };
  }
  return { kind: "text" };
}

function tabSnapshot(tab: vscode.Tab): ResourceTabSnapshot {
  const uri = resourceUri(tab);
  return {
    viewColumn: tab.group.viewColumn,
    resourceKey: uri?.toString(),
    fsPath: uri ? resourceFsPath(uri) : undefined,
    editorKind: uri ? editorKind(tab) : undefined,
  };
}

async function restoreEditor(uri: vscode.Uri, restore: EditorRestore): Promise<void> {
  const options = {
    viewColumn: restore.viewColumn,
    preview: true,
    preserveFocus: true,
  };
  if (restore.editorKind.kind === "notebook") {
    const document = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(document, options);
  } else if (restore.editorKind.kind === "custom") {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      restore.editorKind.viewType,
      options,
    );
  } else {
    await vscode.window.showTextDocument(uri, options);
  }
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function activeResourcePath(): string | undefined {
  const activeEditor = vscode.window.activeTextEditor?.document.uri;
  if (activeEditor) {
    const path = resourceFsPath(activeEditor);
    if (path) {
      return path;
    }
  }
  const groups = [
    vscode.window.tabGroups.activeTabGroup,
    ...vscode.window.tabGroups.all.filter((group) => !group.isActive),
  ];
  for (const group of groups) {
    const uri = resourceUri(group.activeTab);
    if (uri) {
      const path = resourceFsPath(uri);
      if (path) {
        return path;
      }
    }
  }
  return undefined;
}
