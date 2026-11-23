import "server-only";
import { get, put } from "@vercel/blob";

/** Gift photos live in a private Vercel Blob store; only logged-in admins can read them. */

const PREFIX = "gifts/";
const inMemoryMode = () => !process.env.BLOB_READ_WRITE_TOKEN && process.env.NODE_ENV !== "production";
const memory = new Map<string, { type: string; bytes: ArrayBuffer }>(); // local demo only

export async function savePhoto(code: string, file: File) {
  const safe = code.replace(/[^\w-]/g, "") || "unknown";
  const pathname = `${PREFIX}${safe}-${Date.now()}.jpg`;
  if (inMemoryMode()) {
    memory.set(pathname, { type: file.type, bytes: await file.arrayBuffer() });
    return pathname;
  }
  const blob = await put(pathname, file, {
    access: "private",
    contentType: file.type || "image/jpeg",
    addRandomSuffix: true,
  });
  return blob.pathname;
}

export async function readPhoto(pathname: string): Promise<{ body: BodyInit; type: string } | null> {
  if (!pathname.startsWith(PREFIX) || pathname.includes("..")) return null;
  if (inMemoryMode()) {
    const m = memory.get(pathname);
    return m ? { body: m.bytes, type: m.type } : null;
  }
  const res = await get(pathname, { access: "private" });
  if (!res || res.statusCode !== 200) return null;
  return { body: res.stream, type: res.blob.contentType };
}
