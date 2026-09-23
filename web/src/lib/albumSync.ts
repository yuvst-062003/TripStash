/**
 * Syncing an album, within what a browser actually allows.
 *
 * A web app cannot read your photo library. No browser grants standing access
 * to it, and that is the platform's rule rather than a gap here. What it does
 * allow is this: you pick files, and the page reads exactly those.
 *
 * So "sync" is built the only honest way. You select the whole album - the
 * operating system's picker has a select-all - and the page works out which of
 * them it has already seen, by hashing each file on the device and asking the
 * server about the hashes. Re-selecting two hundred videos then costs a few
 * kilobytes of hashes instead of re-uploading gigabytes of video.
 *
 * On desktop Chrome and Edge there is one step better: the File System Access
 * API can remember a folder between visits, so a later sync needs no picking at
 * all. That is a progressive enhancement, not the main path.
 */

const MEDIA_PATTERN = /\.(mp4|mov|m4v|webm|jpg|jpeg|png|heic|heif|gif|webp)$/i

// crypto.subtle.digest needs the whole file in memory at once. Anything larger
// than this is treated as new rather than read twice.
const MAX_HASHABLE_BYTES = 300 * 1024 * 1024

export interface SyncPlan {
  /** Files the server has never seen, in selection order. */
  fresh: File[]
  /** How many of the selected files were already saved. */
  alreadySaved: number
  /** Files too large to hash, which are offered anyway. */
  unhashable: number
}

export interface SyncProgress {
  phase: 'reading' | 'checking' | 'uploading' | 'done'
  done: number
  total: number
}

/** SHA-256 of the raw bytes: the same fingerprint the server stores. */
export async function fingerprintFile(file: File): Promise<string | null> {
  if (file.size > MAX_HASHABLE_BYTES) return null
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function isMedia(file: File): boolean {
  return file.type.startsWith('video/') || file.type.startsWith('image/') ||
    MEDIA_PATTERN.test(file.name)
}

/**
 * Work out what is actually new, before a single byte is uploaded.
 *
 * `askServer` receives hashes only. A hash reveals nothing about a file the
 * server has not already got, so asking is cheaper *and* tells it less than
 * uploading would.
 */
export async function planSync(
  files: File[],
  askServer: (fingerprints: string[]) => Promise<string[]>,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncPlan> {
  const media = files.filter(isMedia)
  const hashed: { file: File; fingerprint: string | null }[] = []

  for (const [index, file] of media.entries()) {
    onProgress?.({ phase: 'reading', done: index, total: media.length })
    hashed.push({ file, fingerprint: await fingerprintFile(file) })
  }

  const fingerprints = hashed
    .map((entry) => entry.fingerprint)
    .filter((value): value is string => value !== null)

  onProgress?.({ phase: 'checking', done: media.length, total: media.length })
  const known = new Set(fingerprints.length ? await askServer(fingerprints) : [])

  const fresh = hashed
    .filter((entry) => entry.fingerprint === null || !known.has(entry.fingerprint))
    .map((entry) => entry.file)

  return {
    fresh,
    alreadySaved: media.length - fresh.length,
    unhashable: hashed.filter((entry) => entry.fingerprint === null).length,
  }
}

/* ---------------------------------------------------------------------------
   Remembering a folder, where the browser supports it
--------------------------------------------------------------------------- */

interface DirectoryHandleLike {
  kind: 'directory'
  name: string
  values: () => AsyncIterableIterator<{ kind: string; name: string; getFile?: () => Promise<File> }>
  queryPermission?: (options: { mode: string }) => Promise<PermissionState>
  requestPermission?: (options: { mode: string }) => Promise<PermissionState>
}

const DB_NAME = 'tripstash'
const STORE = 'album'
const KEY = 'folder'

export function supportsFolderMemory(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await openDb()
    return await new Promise<T | null>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve((request.result as T) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    // Private browsing, blocked storage, no IndexedDB: the picker still works.
    return null
  }
}

export async function rememberFolder(): Promise<string | null> {
  const picker = (window as unknown as {
    showDirectoryPicker: (options?: object) => Promise<DirectoryHandleLike>
  }).showDirectoryPicker
  if (typeof picker !== 'function') return null

  try {
    const handle = await picker({ id: 'tripstash-album', mode: 'read' })
    await withStore('readwrite', (store) => store.put(handle, KEY))
    return handle.name
  } catch {
    // The traveller cancelled, which is not an error.
    return null
  }
}

export async function forgetFolder(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY))
}

export async function rememberedFolderName(): Promise<string | null> {
  const handle = await withStore<DirectoryHandleLike>('readonly', (store) => store.get(KEY))
  return handle?.name ?? null
}

/**
 * Re-read the remembered folder. Permission may have lapsed, in which case the
 * browser asks again - it will not hand over files behind your back.
 */
export async function readRememberedFolder(): Promise<File[] | null> {
  const handle = await withStore<DirectoryHandleLike>('readonly', (store) => store.get(KEY))
  if (!handle) return null

  const granted = await handle.queryPermission?.({ mode: 'read' })
  if (granted !== 'granted') {
    const asked = await handle.requestPermission?.({ mode: 'read' })
    if (asked !== 'granted') return null
  }

  const files: File[] = []
  try {
    for await (const entry of handle.values()) {
      if (entry.kind !== 'file' || !entry.getFile) continue
      const file = await entry.getFile()
      if (isMedia(file)) files.push(file)
    }
  } catch {
    return null
  }
  return files
}
