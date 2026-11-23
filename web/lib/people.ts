import "server-only";
import { readTable, writeCells, type Cell, type CellUpdate, type Table } from "./sheet";

export type Person = {
  row: number;
  code: string;
  company: string;
  name: string;
  position: string;
  dept: string;
  nickname: string;
  nickShort: string;
  received: boolean;
  receivedAt: string;
  /** admin only: blob pathname of the gift photo */
  photo?: string;
  /** admin only */
  checkedBy?: string;
};

const H = {
  code: "รหัสพนักงาน",
  company: "บริษัท",
  name: "ชื่อพนักงาน",
  position: "PositionName",
  dept: "หน่วยงาน",
  nickname: "NickName",
  status: "Status",
  timestamp: "Timestamp",
  photo: "Photo",
  checkedBy: "CheckedBy",
} as const;

type Cols = Record<keyof typeof H, number> & { nickShort: number }; // 1-based, 0 = missing

function columns(header: string[]): Cols {
  const find = (label: string, nth = 0) => {
    let seen = 0;
    for (let i = 0; i < header.length; i++) {
      if (String(header[i]).trim() === label && seen++ === nth) return i + 1;
    }
    return 0;
  };
  const cols = {} as Cols;
  for (const [k, label] of Object.entries(H)) cols[k as keyof typeof H] = find(label);
  cols.nickShort = find(H.nickname, 1);
  return cols;
}

const str = (v: Cell | undefined) => (v == null ? "" : String(v).trim());

function toPerson(r: Cell[], row: number, c: Cols, isAdmin: boolean): Person | null {
  const get = (col: number) => (col ? r[col - 1] : undefined);
  const name = str(get(c.name));
  if (!name) return null;
  const status = get(c.status);
  const p: Person = {
    row,
    code: str(get(c.code)),
    company: str(get(c.company)),
    name,
    position: str(get(c.position)),
    dept: str(get(c.dept)),
    nickname: str(get(c.nickname)),
    nickShort: str(get(c.nickShort)),
    received: status === true || str(status).toUpperCase() === "TRUE",
    receivedAt: str(get(c.timestamp)),
  };
  if (isAdmin) {
    p.photo = photoPathFromCell(str(get(c.photo)));
    p.checkedBy = str(get(c.checkedBy));
  }
  return p;
}

function photoPathFromCell(v: string) {
  if (!v) return "";
  try {
    return new URL(v).searchParams.get("p") ?? "";
  } catch {
    return "";
  }
}

/* short in-process cache so polling from several phones doesn't hammer the Sheets API */
let cache: { at: number; table: Table } | null = null;
const CACHE_MS = 3000;

async function table(fresh = false) {
  if (!fresh && cache && performance.now() - cache.at < CACHE_MS) return cache.table;
  const t = await readTable();
  cache = { at: performance.now(), table: t };
  return t;
}

export async function listPeople(isAdmin: boolean): Promise<Person[]> {
  const t = await table();
  const c = columns(t.header);
  const out: Person[] = [];
  t.rows.forEach((r, i) => {
    const p = toPerson(r, i + 2, c, isAdmin);
    if (p) out.push(p);
  });
  return out;
}

export class RowChangedError extends Error {
  constructor() {
    super("ข้อมูลในชีตเปลี่ยนไปแล้ว ให้รีเฟรชหน้าแล้วลองใหม่");
  }
}

/** Re-read the sheet, confirm the row still belongs to this employee, return its columns. */
export async function lockRow(row: number, code: string) {
  const t = await table(true);
  const c = columns(t.header);
  for (const k of ["status", "timestamp", "name", "code"] as const) {
    if (!c[k]) throw new Error(`ไม่พบคอลัมน์ "${H[k]}" ในแถวหัวตาราง`);
  }
  const r = t.rows[row - 2];
  if (!Number.isInteger(row) || row < 2 || !r || str(r[c.code - 1]) !== String(code).trim()) {
    throw new RowChangedError();
  }

  // add Photo / CheckedBy headers after the last used column if they're missing
  const headerUpdates: CellUpdate[] = [];
  let next = t.header.length + 1;
  for (const k of ["photo", "checkedBy"] as const) {
    if (!c[k]) {
      c[k] = next++;
      headerUpdates.push({ row: 1, col: c[k], value: H[k] });
    }
  }
  return { cols: c, values: r, headerUpdates };
}

export async function saveRow(row: number, updates: CellUpdate[], isAdmin: boolean) {
  await writeCells(updates);
  cache = null;
  const t = await table(true);
  return toPerson(t.rows[row - 2] ?? [], row, columns(t.header), isAdmin);
}

/** Thai-style timestamp written to the sheet, e.g. 23/11/2569 10:32:05 */
export function thaiTimestamp(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${Number(parts.year) + 543} ${parts.hour}:${parts.minute}:${parts.second}`;
}
