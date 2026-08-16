export type CwdMode = "auto" | "workspaceRoot" | "prompt";
export type LaunchMode = "loginShell" | "profile";

export interface ExtensionConfiguration {
  command: string;
  args: readonly string[];
  cwdMode: CwdMode;
  launchMode: LaunchMode;
  titleMaxLength: number;
}

export interface WorkspaceFolderDescriptor {
  name: string;
  fsPath: string;
}

export type WorkingDirectoryChoice =
  | { kind: "path"; fsPath: string }
  | { kind: "prompt"; folders: readonly WorkspaceFolderDescriptor[] }
  | { kind: "unavailable" };

export type LaunchPlan =
  | {
      kind: "loginShell";
      commandLine: string;
      executable: string;
      args: readonly string[];
    }
  | { kind: "profile"; commandLine: string };

export type EditorKind =
  | { kind: "text" }
  | { kind: "notebook" }
  | { kind: "custom"; viewType: string };

export interface ResourceTabSnapshot {
  viewColumn: number;
  resourceKey?: string;
  fsPath?: string;
  editorKind?: EditorKind;
}

export interface EditorRestore {
  resourceKey: string;
  viewColumn: number;
  editorKind: EditorKind;
}

export interface DropInterception {
  destinationColumn: number;
  paths: readonly string[];
  closeResourceKeys: readonly string[];
  restore: readonly EditorRestore[];
}

