import type {
  DropInterception,
  ResourceTabSnapshot,
} from "./types";

export function planDropInterception(
  opened: readonly ResourceTabSnapshot[],
  closed: readonly ResourceTabSnapshot[],
  piColumns: ReadonlySet<number>,
): DropInterception | undefined {
  let destinationColumn: number | undefined;
  const paths: string[] = [];
  const closeResourceKeys: string[] = [];
  const restore: DropInterception["restore"][number][] = [];

  for (const openedTab of opened) {
    if (
      !piColumns.has(openedTab.viewColumn) ||
      !openedTab.resourceKey ||
      !openedTab.fsPath
    ) {
      continue;
    }
    const origin = closed.find(
      (closedTab) =>
        closedTab.resourceKey === openedTab.resourceKey &&
        closedTab.viewColumn !== openedTab.viewColumn,
    );
    if (!origin) {
      continue;
    }

    destinationColumn ??= openedTab.viewColumn;
    if (destinationColumn !== openedTab.viewColumn) {
      continue;
    }
    paths.push(openedTab.fsPath);
    closeResourceKeys.push(openedTab.resourceKey);
    restore.push({
      resourceKey: openedTab.resourceKey,
      viewColumn: origin.viewColumn,
      editorKind:
        openedTab.editorKind ?? origin.editorKind ?? { kind: "text" },
    });
  }

  return destinationColumn === undefined || paths.length === 0
    ? undefined
    : { destinationColumn, paths, closeResourceKeys, restore };
}

