import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type Admin = { username: string; name: string };

const COOKIE = "gift_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const dev = process.env.NODE_ENV !== "production";

/**
 * ADMIN_USERS="admin:รหัสผ่าน:ชื่อที่แสดง,staff2:รหัส2:แอดมินคนที่ 2"
 * The password may contain ":" (username is before the first ":", name after the last).
 */
function admins(): (Admin & { password: string })[] {
  const raw = process.env.ADMIN_USERS || (dev ? "admin:admin:แอดมิน (ทดลอง)" : "");
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const first = entry.indexOf(":");
      const last = entry.lastIndexOf(":");
      if (first < 0 || last <= first) return null;
      return {
        username: entry.slice(0, first).trim().toLowerCase(),
        password: entry.slice(first + 1, last),
        name: entry.slice(last + 1).trim(),
      };
    })
    .filter((a): a is Admin & { password: string } => !!a && !!a.username && !!a.password);
}

function secret() {
  const s = process.env.SESSION_SECRET || (dev ? "dev-only-secret" : "");
  if (s.length < 16 && !dev) throw new Error("SESSION_SECRET ต้องยาวอย่างน้อย 16 ตัวอักษร");
  return s;
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkLogin(username: string, password: string): Admin | null {
  const u = username.trim().toLowerCase();
  const found = admins().find((a) => a.username === u);
  // compare even when the user isn't found, so timing doesn't reveal valid usernames
  const ok = safeEqual(found?.password ?? "\u0000invalid", password);
  return found && ok ? { username: found.username, name: found.name } : null;
}

export async function startSession(admin: Admin) {
  const payload = Buffer.from(
    JSON.stringify({ ...admin, exp: Date.now() + SESSION_SECONDS * 1000 })
  ).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: !dev,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function getAdmin(): Promise<Admin | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Admin & { exp: number };
    if (data.exp < Date.now()) return null;
    // a removed admin loses access on their next request
    if (!admins().some((a) => a.username === data.username)) return null;
    return { username: data.username, name: data.name };
  } catch {
    return null;
  }
}
