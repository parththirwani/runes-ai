// Which workspace files hold unsaved bytes.
//
// The rule lives apart from useWorkspace so it can be tested directly: a file counts as dirty
// only when its own bytes differ from its own saved bytes. Nothing about another file can make
// it dirty, which is what keeps an accepted AI edit (or an ordinary keystroke) in one file from
// marking any other open file unsaved. The tab dots, the save queue and autosave all read this
// one derivation, so they cannot disagree about what still needs writing.

export type DirtyCheckFile = {
  path: string;
  content: string;
  savedContent: string;
  loaded: boolean;
  binary: boolean;
};

/** True when this single file holds bytes that were never saved. */
export function isDirtyFile(file: DirtyCheckFile): boolean {
  return !file.binary && file.loaded && file.content !== file.savedContent;
}

/** Every path with unsaved bytes, in the order the workspace map holds them. */
export function dirtyPathsOf(filesByPath: Record<string, DirtyCheckFile>): string[] {
  return Object.values(filesByPath).filter(isDirtyFile).map((file) => file.path);
}
