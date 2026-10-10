/**
 * Saving to the user's file.
 * Chromium uses the File System Access API save dialog; other browsers download.
 *
 * The dialog must open "right after the click (within the user-activation window)", so
 * choosing the target (pickSaveTarget) and writing the bytes (writeSaveTarget) are separated.
 * Callers must call pickSaveTarget before slow work (commit, PDF generation).
 */
export type SaveTarget =
  { kind: 'handle'; handle: FileSystemFileHandle } | { kind: 'download'; name: string } | { kind: 'cancelled' };

type Picker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

export interface FileType {
  description: string;
  mime: string;
  extension: string;
}
const PDF_TYPE: FileType = { description: 'PDF', mime: 'application/pdf', extension: '.pdf' };
export const JSON_TYPE: FileType = { description: 'JSON', mime: 'application/json', extension: '.json' };

export async function pickSaveTarget(suggestedName: string, type: FileType = PDF_TYPE): Promise<SaveTarget> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (!picker) return { kind: 'download', name: suggestedName };
  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: type.description, accept: { [type.mime]: [type.extension] } }],
    });
    return { kind: 'handle', handle };
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return { kind: 'cancelled' };
    // Fall back to a download when the user activation expired or policy refused the dialog
    console.warn('showSaveFilePicker failed, falling back to download:', e);
    return { kind: 'download', name: suggestedName };
  }
}

export async function writeSaveTarget(
  target: SaveTarget,
  bytes: Uint8Array | string,
  type: FileType = PDF_TYPE,
): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: type.mime });
  if (target.kind === 'handle') {
    const w = await target.handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  if (target.kind === 'download') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = target.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}
