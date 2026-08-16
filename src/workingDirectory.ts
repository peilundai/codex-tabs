import * as os from "node:os";
import * as path from "node:path";
import type {
  CwdMode,
  WorkingDirectoryChoice,
  WorkspaceFolderDescriptor,
} from "./types";

export function chooseWorkingDirectory(
  folders: readonly WorkspaceFolderDescriptor[],
  activeFilePath: string | undefined,
  mode: CwdMode,
  homeDirectory = os.homedir(),
): WorkingDirectoryChoice {
  if (folders.length === 0) {
    return homeDirectory
      ? { kind: "path", fsPath: homeDirectory }
      : { kind: "unavailable" };
  }

  if (mode === "prompt" && folders.length > 1) {
    return { kind: "prompt", folders: [...folders] };
  }

  if (mode === "workspaceRoot" || folders.length === 1 || !activeFilePath) {
    return { kind: "path", fsPath: folders[0].fsPath };
  }

  const activeFolder = [...folders]
    .filter((folder) => pathIsWithin(activeFilePath, folder.fsPath))
    .sort((left, right) => right.fsPath.length - left.fsPath.length)[0];

  return {
    kind: "path",
    fsPath: activeFolder?.fsPath ?? folders[0].fsPath,
  };
}

export function pathIsWithin(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

