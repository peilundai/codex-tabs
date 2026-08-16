import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";

interface Disposable {
  dispose(): void;
}

interface FakeTerminal {
  readonly name: string;
  readonly exitStatus: undefined;
  show(preserveFocus?: boolean): void;
  sendText(text: string, addNewLine?: boolean): void;
  dispose(): void;
}

interface TerminalCreationOptions {
  name: string;
  iconPath: { light: string; dark: string };
  location: { viewColumn: number; preserveFocus: boolean };
}

type ModuleLoad = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

test("activation registers all commands and live chats reuse one concrete group", async () => {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const createdAtColumns: number[] = [];
  const createdIconPaths: Array<{ light: string; dark: string }> = [];
  const terminals: FakeTerminal[] = [];
  const disposable = (): Disposable => ({ dispose: () => undefined });
  let activeTerminal: FakeTerminal | undefined;
  let activeTerminalListener:
    | ((terminal: FakeTerminal | undefined) => void)
    | undefined;
  let closeTerminalListener: ((terminal: FakeTerminal) => void) | undefined;

  class FakeTabInputTerminal {}

  const activeGroup: {
    viewColumn: number;
    activeTab?: { input: FakeTabInputTerminal };
    isActive: boolean;
  } = { viewColumn: 1, activeTab: undefined, isActive: true };

  const windowMock = {
    get activeTerminal(): FakeTerminal | undefined {
      return activeTerminal;
    },
    terminals,
    activeTextEditor: undefined,
    tabGroups: {
      activeTabGroup: activeGroup,
      all: [activeGroup],
      onDidChangeTabs: () => disposable(),
      close: async () => true,
    },
    createOutputChannel: () => ({
      appendLine: (_message: string) => undefined,
      show: (_preserveFocus?: boolean) => undefined,
      dispose: () => undefined,
    }),
    onDidCloseTerminal: (listener: (terminal: FakeTerminal) => void) => {
      closeTerminalListener = listener;
      return disposable();
    },
    onDidChangeActiveTerminal: (
      listener: (terminal: FakeTerminal | undefined) => void,
    ) => {
      activeTerminalListener = listener;
      return disposable();
    },
    createTerminal: (options: TerminalCreationOptions): FakeTerminal => {
      createdAtColumns.push(options.location.viewColumn);
      createdIconPaths.push(options.iconPath);
      const terminal: FakeTerminal = {
        name: options.name,
        exitStatus: undefined,
        show: () => {
          activeTerminal = terminal;
          activeGroup.viewColumn =
            options.location.viewColumn === -2
              ? 2
              : options.location.viewColumn;
          activeGroup.activeTab = { input: new FakeTabInputTerminal() };
          activeTerminalListener?.(terminal);
        },
        sendText: () => undefined,
        dispose: () => {
          const index = terminals.indexOf(terminal);
          if (index >= 0) {
            terminals.splice(index, 1);
          }
          closeTerminalListener?.(terminal);
        },
      };
      terminals.push(terminal);
      return terminal;
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
  };

  const vscodeMock = {
    window: windowMock,
    workspace: {
      workspaceFolders: [
        { name: "workspace", uri: { scheme: "file", fsPath: "/tmp" } },
      ],
      getConfiguration: () => ({
        get: (key: string): unknown =>
          ({
            command: "/usr/bin/true",
            args: [],
            cwdMode: "auto",
            launchMode: "loginShell",
            titleMaxLength: 24,
          })[key as "command"],
      }),
      openNotebookDocument: async () => undefined,
    },
    commands: {
      registerCommand: (
        command: string,
        handler: (...args: unknown[]) => unknown,
      ) => {
        registered.set(command, handler);
        return disposable();
      },
      executeCommand: async () => undefined,
    },
    Uri: {
      joinPath: (_base: unknown, ...parts: string[]) => parts.join("/"),
    },
    ViewColumn: { Beside: -2 },
    TabInputTerminal: FakeTabInputTerminal,
    TabInputText: class {},
    TabInputNotebook: class {},
    TabInputCustom: class {},
    EventEmitter: class {
      readonly event = () => disposable();
      fire(_value: unknown): void {}
      dispose(): void {}
    },
  };

  const loader = Module as unknown as { _load: ModuleLoad };
  const originalLoad = loader._load;
  loader._load = (request, parent, isMain) =>
    request === "vscode"
      ? vscodeMock
      : originalLoad.call(Module, request, parent, isMain);

  const subscriptions: Disposable[] = [];
  try {
    const extension = await import("../src/extension");
    const activate = extension.activate as unknown as (context: {
      subscriptions: Disposable[];
      extensionUri: unknown;
      asAbsolutePath(relativePath: string): string;
    }) => void;
    activate({
      subscriptions,
      extensionUri: {},
      asAbsolutePath: (relativePath) => `/extension/${relativePath}`,
    });

    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      contributes: { commands: Array<{ command: string }> };
    };
    assert.deepEqual(
      [...registered.keys()].sort(),
      manifest.contributes.commands.map((item) => item.command).sort(),
    );

    await registered.get("codexTabs.newChat")?.();
    await registered.get("codexTabs.newChat")?.();
    assert.deepEqual(createdAtColumns, [-2, 2]);
    assert.deepEqual(createdIconPaths, [
      {
        light: "media/codex-tab-icon-light.png",
        dark: "media/codex-tab-icon.png",
      },
      {
        light: "media/codex-tab-icon-light.png",
        dark: "media/codex-tab-icon.png",
      },
    ]);

    await registered.get("codexTabs.open")?.();
    assert.equal(terminals.length, 2, "Open Agent should reveal, not create");
  } finally {
    for (const subscription of subscriptions.reverse()) {
      subscription.dispose();
    }
    loader._load = originalLoad;
  }
});
