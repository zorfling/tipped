import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = path.join(process.cwd(), ".uploads", "photos");

function onNetlify(): boolean {
  return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}

/**
 * Store a profile photo (already square-cropped client-side) and return the
 * public URL. Netlify Blobs in deploys; local filesystem in dev.
 */
export async function savePhoto(userId: string, data: Buffer): Promise<string> {
  if (onNetlify()) {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("photos");
    await store.set(userId, new Blob([new Uint8Array(data)]));
  } else {
    await mkdir(LOCAL_DIR, { recursive: true });
    await writeFile(path.join(LOCAL_DIR, userId), data);
  }
  return `/api/photos/${userId}?v=${Date.now()}`;
}

export async function readPhoto(userId: string): Promise<Buffer | null> {
  if (onNetlify()) {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("photos");
    const blob = await store.get(userId, { type: "arrayBuffer" });
    return blob ? Buffer.from(blob) : null;
  }
  try {
    return await readFile(path.join(LOCAL_DIR, userId));
  } catch {
    return null;
  }
}
