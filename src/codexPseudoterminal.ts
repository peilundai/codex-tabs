import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";
import { rewriteDroppedPathPayload } from "./pathMentions";
import { consumeOscTitles, safeTitleFromOsc } from "./titleParser";
import type { BridgeLaunch } from "./pythonBridge";

export interface PseudoterminalOptions extends BridgeLaunch {
  cwd?: string;
  environment: NodeJS.ProcessEnv;
  titleMaxLength: number;
  /**
   * Invoked when the child exits, before `onDidClose`.
   * Return `"keep"` to leave the terminal open. Firing `onDidClose` first
   * makes VS Code remove the terminal, and the manager then drops the session
   * before it can preserve an immediate failure.
   */
  onProcessExit?: (exitCode: number) => "keep" | "close";
}

export class CodexPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;

  private readonly closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidClose = this.closeEmitter.event;

  private readonly nameEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeName = this.nameEmitter.event;

  private child: ChildProcess | undefined;
  private resizeControl: NodeJS.WritableStream | undefined;
  private oscCarry = "";
  private finished = false;
  /** Set when VS Code disposes the terminal. That exit is not a startup failure. */
  private closedByHost = false;

  constructor(private readonly options: PseudoterminalOptions) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    if (this.child) {
      return;
    }

    const args = [
      ...this.options.bridgeArgs,
      "--columns",
      String(initialDimensions?.columns ?? 80),
      "--rows",
      String(initialDimensions?.rows ?? 24),
      "--control-fd",
      "3",
      "--",
      ...this.options.childCommand,
    ];
    const child = spawn(this.options.executable, args, {
      cwd: this.options.cwd,
      env: this.options.environment,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    this.child = child;
    const control = child.stdio[3];
    this.resizeControl =
      control && "write" in control
        ? (control as NodeJS.WritableStream)
        : undefined;
    // A terminal can close while VS Code is still delivering buffered input
    // or a resize event. Ignore the resulting pipe errors; child close is the
    // authoritative lifecycle signal handled below.
    child.stdin?.on("error", () => undefined);
    if (control && "on" in control) {
      control.on("error", () => undefined);
    }
    this.nameEmitter.fire(EXTENSION_NAME);

    const decoder = new StringDecoder("utf8");
    child.stdout?.on("data", (data: Buffer) => {
      this.forwardOutput(decoder.write(data));
    });
    child.stderr?.on("data", (data: Buffer) => {
      this.writeEmitter.fire(data.toString("utf8"));
    });
    child.once("error", (error) => {
      this.writeEmitter.fire(
        `\r\n${EXTENSION_NAME} could not start: ${error.message}\r\n`,
      );
      this.finish(1);
    });
    child.once("close", (code) => {
      const remaining = decoder.end();
      if (remaining) {
        this.forwardOutput(remaining);
      }
      this.finish(code ?? 1);
    });
  }

  close(): void {
    if (!this.finished) {
      this.closedByHost = true;
      this.child?.kill("SIGTERM");
    }
  }

  handleInput(data: string): void {
    this.child?.stdin?.write(
      rewriteDroppedPathPayload(data, this.options.cwd) ?? data,
    );
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.resizeControl?.write(`${dimensions.columns} ${dimensions.rows}\n`);
  }

  private forwardOutput(data: string): void {
    this.writeEmitter.fire(data);
    const parsed = consumeOscTitles(data, this.oscCarry);
    this.oscCarry = parsed.carry;
    for (const payload of parsed.payloads) {
      const title = safeTitleFromOsc(payload, this.options.titleMaxLength);
      if (title) {
        this.nameEmitter.fire(title);
      }
    }
  }

  private finish(exitCode: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    // Host disposal already removes the terminal. A process exit must be
    // classified first: `onDidClose` disposes the terminal and deletes the
    // managed session before any later guard can preserve it.
    const decision = this.closedByHost
      ? "close"
      : (this.options.onProcessExit?.(exitCode) ?? "close");
    if (decision !== "keep") {
      this.closeEmitter.fire(exitCode);
    }
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
    this.nameEmitter.dispose();
  }
}
