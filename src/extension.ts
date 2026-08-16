import * as vscode from "vscode";
import { COMMANDS, EXTENSION_NAME } from "./constants";
import { CodexTerminalManager } from "./codexTerminalManager";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(EXTENSION_NAME);
  const manager = new CodexTerminalManager(context, output);

  const safe = (description: string, action: () => void | Promise<void>) =>
    async (): Promise<void> => {
      try {
        await action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`${description}: ${message}`);
        void vscode.window.showErrorMessage(`${description}: ${message}`);
      }
    };

  context.subscriptions.push(
    output,
    manager,
    vscode.commands.registerCommand(
      COMMANDS.open,
      safe("Could not open Codex", () => manager.open()),
    ),
    vscode.commands.registerCommand(
      COMMANDS.newChat,
      safe("Could not create a Codex chat", () => manager.newChat()),
    ),
    vscode.commands.registerCommand(
      COMMANDS.resumeChat,
      safe("Could not resume a Codex chat", () => manager.resumeChat()),
    ),
    vscode.commands.registerCommand(
      COMMANDS.forkChat,
      safe("Could not fork a Codex chat", () => manager.forkChat()),
    ),
    vscode.commands.registerCommand(
      COMMANDS.insertPaths,
      (uri?: vscode.Uri, uris?: readonly vscode.Uri[]) =>
        safe("Could not insert the selected path", () =>
          manager.insertPaths(uri, uris),
        )(),
    ),
  );
}

export function deactivate(): void {
  // VS Code disposes all objects registered in the extension context.
}
