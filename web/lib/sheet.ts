import "server-only";
import { createSign } from "node:crypto";

/**
 * Read/write the Google Sheet through the Sheets REST API with a service account.
 * No googleapis dependency: we sign the JWT ourselves to keep cold starts small.
 *
 * Without GOOGLE_SERVICE_ACCOUNT_EMAIL in development, falls back to an in-memory
 * copy of the sheet's public CSV export so the app can be tried locally.
 */

export type Cell = string | number | boolean;
export type Table = { header: string[]; rows: Cell[][] }; // rows[i] is sheet row i + 2
export type CellUpdate = { row: number; col: number; value: Cell }; // 1-based

const SHEET_NAME = process.env.SHEET_NAME || "รายชื่อ";

function sheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("ยังไม่ได้ตั้งค่า SHEET_ID");
  return id;
}

export function isDemo() {
  return !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.NODE_ENV !== "production";
}

/* ---------- Google auth ---------- */

let tokenCache: { token: string; exp: number } | null = null;

function privateKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_PRIVATE_KEY");
  return raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

async function accessToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL");

  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    enc({ alg: "RS256", typ: "JWT" }) +
    "." +
    enc({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey()).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google ปฏิเสธ service account (${res.status}) ให้ตรวจ GOOGLE_PRIVATE_KEY`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function sheetsFetch(path: string, init?: RequestInit) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    cache: "no-store",
  });
  if (res.status === 403) {
    throw new Error("service account ไม่มีสิทธิ์แก้ไข Sheet ให้แชร์ Sheet ให้อีเมล service account เป็นผู้แก้ไข");
  }
  if (!res.ok) throw new Error(`อ่าน/เขียน Google Sheet ไม่สำเร็จ (${res.status})`);
  return res.json();
}

const a1 = (range: string, tab = SHEET_NAME) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`);

export function colLetter(col: number) {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/* ---------- demo store ---------- */

let demo: Table | null = null;

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

async function demoTable(): Promise<Table> {
  if (demo) return demo;
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId()}/export?format=csv`, { cache: "no-store" });
  if (!res.ok) throw new Error(`โหลด Sheet สำหรับโหมดทดลองไม่สำเร็จ (${res.status})`);
  const [header, ...rows] = parseCsv(await res.text());
  demo = {
    header,
    rows: rows.map((r) => r.map((v) => (v === "TRUE" ? true : v === "FALSE" ? false : v))),
  };
  return demo;
}

/* ---------- public API ---------- */

/**
 * Read another tab of the same spreadsheet as text exactly as displayed
 * (so a password like 0123 keeps its leading zero). Read-only, never cached here.
 */
export async function readTab(tab: string): Promise<Table> {
  let values: Cell[][];
  if (isDemo()) {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId()}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`โหลดแท็บ "${tab}" ไม่สำเร็จ (${res.status})`);
    values = parseCsv(await res.text());
  } else {
    const json = (await sheetsFetch(`/values/${a1("A1:ZZ", tab)}?valueRenderOption=FORMATTED_VALUE`)) as {
      values?: Cell[][];
    };
    values = json.values ?? [];
  }
  const [header = [], ...rows] = values;
  return { header: header.map(String), rows };
}

export async function readTable(): Promise<Table> {
  if (isDemo()) {
    const t = await demoTable();
    return { header: [...t.header], rows: t.rows.map((r) => [...r]) };
  }
  const json = (await sheetsFetch(
    `/values/${a1("A1:ZZ")}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
  )) as { values?: Cell[][] };
  const [header = [], ...rows] = json.values ?? [];
  return { header: header.map(String), rows };
}

export async function writeCells(updates: CellUpdate[]) {
  if (!updates.length) return;
  if (isDemo()) {
    const t = await demoTable();
    for (const u of updates) {
      const target = u.row === 1 ? t.header : (t.rows[u.row - 2] ??= []);
      while (target.length < u.col) target.push("");
      target[u.col - 1] = u.row === 1 ? String(u.value) : u.value;
    }
    return;
  }
  await sheetsFetch("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: updates.map((u) => ({
        range: `'${SHEET_NAME.replace(/'/g, "''")}'!${colLetter(u.col)}${u.row}`,
        values: [[u.value]],
      })),
    }),
  });
}
