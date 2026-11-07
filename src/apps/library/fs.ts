// File access for the Library. A web page can't touch your music, so:
// - in the desktop app (Tauri on the Mac): the fs + dialog plugins, any folder
//   you pick (internal disk, /Volumes/<USB>), absolute paths;
// - in Chrome/Edge: the File System Access API (you grant a folder once; the
//   handle is remembered on this device);
// - in tests: an in-memory folder.
// Safari has no folder access, so on iPhone/iPad the Library is read-only.

export interface FileEntry { path: string; size: number; mtime?: number }
export interface FileSource {
  label: string;
  /** Absolute root path (desktop app only): needed for Rekordbox XML and crates. */
  absRoot?: string;
  list(): AsyncGenerator<FileEntry>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
}

export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'mp4', 'flac', 'wav', 'aiff', 'aif', 'alac', 'ogg', 'opus'];
export const extOf = (p: string) => (p.split('.').pop() ?? '').toLowerCase();
export const isAudio = (p: string) => AUDIO_EXT.includes(extOf(p)) && !p.split('/').some((s) => s.startsWith('.') || s === '_Serato_' || s === 'PIONEER');

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const canPickFolders = () => isDesktop() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

// ---- desktop (Tauri) ---------------------------------------------------------

export async function tauriSource(absRoot: string): Promise<FileSource> {
  const fs = await import('@tauri-apps/plugin-fs');
  const root = absRoot.replace(/\/+$/, '');
  async function* walk(dir: string, rel: string): AsyncGenerator<FileEntry> {
    let entries: Awaited<ReturnType<typeof fs.readDir>> = [];
    try { entries = await fs.readDir(dir); } catch { return; }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory && !e.name.startsWith('.') && e.name !== '_Serato_' && e.name !== 'PIONEER') yield* walk(`${dir}/${e.name}`, relPath);
      else if (e.isFile && isAudio(relPath)) {
        try {
          const st = await fs.stat(`${dir}/${e.name}`);
          yield { path: relPath, size: st.size, mtime: st.mtime ? new Date(st.mtime).getTime() : undefined };
        } catch { /* unreadable: skip */ }
      }
    }
  }
  return {
    label: root.split('/').pop() || root,
    absRoot: root,
    list: () => walk(root, ''),
    read: (p) => fs.readFile(`${root}/${p}`),
    write: (p, d) => fs.writeFile(`${root}/${p}`, d),
  };
}

/** Write a file anywhere (desktop only), creating folders: crates, XML. */
export async function writeAbsolute(absPath: string, data: Uint8Array) {
  const fs = await import('@tauri-apps/plugin-fs');
  const dir = absPath.replace(/\/[^/]+$/, '');
  if (!(await fs.exists(dir))) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absPath, data);
}

export async function homeDir(): Promise<string> {
  const p = await import('@tauri-apps/api/path');
  return (await p.homeDir()).replace(/\/+$/, '');
}

// ---- browser (Chrome/Edge) -------------------------------------------------------

type DirHandle = { name: string; kind: 'directory'; values(): AsyncIterable<DirHandle | FileHandle>; getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<DirHandle>; getFileHandle(n: string, o?: { create?: boolean }): Promise<FileHandle>; queryPermission?(o: { mode: string }): Promise<string>; requestPermission?(o: { mode: string }): Promise<string> };
type FileHandle = { name: string; kind: 'file'; getFile(): Promise<File>; createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> };

export function browserSource(handle: unknown): FileSource {
  const h = handle as DirHandle;
  async function* walk(dir: DirHandle, rel: string): AsyncGenerator<FileEntry> {
    for await (const e of dir.values()) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === 'directory') { if (!e.name.startsWith('.') && e.name !== '_Serato_' && e.name !== 'PIONEER') yield* walk(e, relPath); }
      else if (isAudio(relPath)) { const f = await e.getFile(); yield { path: relPath, size: f.size, mtime: f.lastModified }; }
    }
  }
  async function fileHandle(path: string, create = false): Promise<FileHandle> {
    const parts = path.split('/');
    let dir = h;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }
  return {
    label: h.name,
    list: () => walk(h, ''),
    read: async (p) => new Uint8Array(await (await (await fileHandle(p)).getFile()).arrayBuffer()),
    write: async (p, d) => { const w = await (await fileHandle(p, true)).createWritable(); await w.write(d); await w.close(); },
  };
}

/** Ask for read/write permission again (needed after a reload in the browser). */
export async function ensurePermission(handle: unknown): Promise<boolean> {
  const h = handle as DirHandle;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** Pick a folder: an absolute path (desktop) or a handle (browser). */
export async function pickFolder(): Promise<{ absPath?: string; handle?: unknown; name: string } | null> {
  if (isDesktop()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ directory: true, multiple: false });
    if (!p || Array.isArray(p)) return null;
    return { absPath: p, name: p.split('/').pop() || p };
  }
  const w = window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<DirHandle> };
  if (!w.showDirectoryPicker) return null;
  try { const h = await w.showDirectoryPicker({ mode: 'readwrite' }); return { handle: h, name: h.name }; }
  catch { return null; }
}

// ---- tests -----------------------------------------------------------------------

export function memorySource(files: Record<string, Uint8Array>, label = 'Test', absRoot = '/Test'): FileSource & { files: Record<string, Uint8Array> } {
  return {
    files, label, absRoot,
    async *list() { for (const [path, d] of Object.entries(files)) if (isAudio(path)) yield { path, size: d.length, mtime: 1 }; },
    read: async (p) => { if (!files[p]) throw new Error('not found'); return files[p]; },
    write: async (p, d) => { files[p] = d; },
  };
}

/** Save bytes as a download (browser) or via a save dialog (desktop). */
export async function saveAs(name: string, data: Uint8Array | string, mime: string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const p = await save({ defaultPath: name });
    if (p) await writeAbsolute(p, bytes);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
