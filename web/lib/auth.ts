import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { readTab } from "./sheet";

export type Admin = { username: string; name: string; role: string };
type Account = Admin & { password: string; fromEnv?: boolean };

const COOKIE = "gift_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const dev = process.env.NODE_ENV !== "production";
const LOGIN_TAB = process.env.LOGIN_SHEET_NAME || "รหัสผ่าน";
const ACCOUNTS_CACHE_MS = 30_000;

/**
 * Optional fallback accounts that work even if the sheet can't be read:
 * ADMIN_USERS="admin:รหัสผ่าน:ชื่อที่แสดง,staff2:รหัส2:แอดมินคนที่ 2"
 * The password may contain ":" (username is before the first ":", name after the last).
 */
function envAdmins(): Account[] {
  const raw = process.env.ADMIN_USERS || "";
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
        role: "Admin",
      };
    })
    .filter((a): a is Account => !!a && !!a.username && !!a.password);
}

/** Accounts from the "รหัสผ่าน" tab: columns Username, Name, Password, Role (found by header, any order). */
async function sheetAdmins(): Promise<Account[]> {
  const t = await readTab(LOGIN_TAB);
  const col = (label: string) => t.header.findIndex((h) => h.trim().toLowerCase() === label);
  const [u, n, p, r] = ["username", "name", "password", "role"].map(col);
  if (u < 0 || p < 0) throw new Error(`แท็บ "${LOGIN_TAB}" ต้องมีคอลัมน์ Username และ Password`);
  const cell = (row: unknown[], i: number) => (i < 0 || row[i] == null ? "" : String(row[i]).trim());
  return t.rows
    .map((row) => ({
      username: cell(row, u).toLowerCase(),
      password: cell(row, p),
      name: cell(row, n) || cell(row, u),
      role: cell(row, r) || "Admin",
    }))
    .filter((a) => a.username && a.password);
}

let accountCache: { at: number; list: Account[] } | null = null;

async function admins(): Promise<Account[]> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNTS_CACHE_MS) return accountCache.list;
  let fromSheet: Account[];
  try {
    fromSheet = await sheetAdmins();
  } catch (e) {
    console.error("[auth] อ่านรายชื่อผู้ใช้จาก Sheet ไม่สำเร็จ", e);
    // keep serving the last good copy for a while instead of locking everyone out
    fromSheet = accountCache?.list.filter((a) => !a.fromEnv) ?? [];
  }
  const taken = new Set(fromSheet.map((a) => a.username));
  const fallback = envAdmins().filter((a) => !taken.has(a.username));
  if (!fromSheet.length && !fallback.length && dev) {
    fallback.push({ username: "admin", password: "admin", name: "แอดมิน (ทดลอง)", role: "Admin" });
  }
  const list = [...fromSheet, ...fallback.map((a) => ({ ...a, fromEnv: true }))];
  accountCache = { at: Date.now(), list };
  return list;
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

export async function checkLogin(username: string, password: string): Promise<Admin | null> {
  const u = username.trim().toLowerCase();
  const found = (await admins()).find((a) => a.username === u);
  // compare even when the user isn't found, so timing doesn't reveal valid usernames
  const ok = safeEqual(found?.password ?? "\u0000invalid", password.trim());
  return found && ok ? { username: found.username, name: found.name, role: found.role } : null;
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
    const account = (await admins()).find((a) => a.username === data.username);
    if (!account) return null;
    return { username: account.username, name: account.name, role: account.role };
  } catch {
    return null;
  }
}
