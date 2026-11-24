import type { Person } from "./people";

/**
 * Numbers for the dashboard, computed from the public list of people.
 * Pure functions (no I/O, no clock of their own) so they can run on the server and in the browser
 * and be tested directly.
 *
 * Timestamps in the sheet are Thai local time written as "24/11/2569 09:21:45" (Buddhist year).
 * We read them into "wall-clock milliseconds": Date.UTC of the written numbers, i.e. the Bangkok
 * clock reading treated as if it were UTC. Differences are real durations, and the UTC getters
 * give the Bangkok clock back, so no time zone maths is needed.
 */

export type Group = {
  name: string;
  total: number;
  got: number;
  /** when the last person in the group handed in a gift, once everyone has (and every time is known) */
  doneAt?: number;
};
export type Point = {
  /** wall-clock ms at the end of this slot (the end of the line for the last one) */
  at: number;
  /** start of the slot, for the tooltip and the table */
  from: number;
  added: number;
  cumulative: number;
};
export type Recent = { row: number; code: string; name: string; nickname: string; company: string; dept: string; at: number };
export type Stats = {
  total: number;
  got: number;
  pending: number;
  pct: number;
  companies: Group[];
  depts: Group[];
  /** the Chief areas of every company that has them (empty when the sheet has no real Chief level) */
  chiefs: Group[];
  doneDepts: number;
  /** people marked received whose Timestamp is empty or unreadable: counted, but not on the timeline */
  untimed: number;
  /** the departments that are complete, the first to finish first */
  finished: Group[];
  lastAt: number | null;
  lastHour: number;
  recent: Recent[];
  timeline: { slotMs: number; start: number; points: Point[] };
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const NO_DEPT = "ไม่ระบุหน่วยงาน";
export const NO_COMPANY = "ไม่ระบุบริษัท";
export const NO_CHIEF = "ไม่ระบุ Chief";

/** The three levels a person sits in: company, then Chief (the executive area), then department. Blanks get a readable name. */
export const companyOf = (p: Person) => p.company || NO_COMPANY;
export const chiefOf = (p: Person) => p.chief || NO_CHIEF;
export const deptOf = (p: Person) => p.dept || NO_DEPT;
/** The Chief to show beside a name: nothing when it is blank or just repeats the company (as it does for companies without areas). */
export const shownChief = (p: Person) => (p.chief && p.chief !== p.company ? p.chief : "");

export type Scope = { company: string; chief: string; dept: string };
export const NO_SCOPE: Scope = { company: "", chief: "", dept: "" };
export const inScope = (p: Person, s: Scope) =>
  (!s.company || companyOf(p) === s.company) && (!s.chief || chiefOf(p) === s.chief) && (!s.dept || deptOf(p) === s.dept);

/** How far along: behind (under half), getting there, nearly or fully done. Drives the ring and bar colours. */
export type Tone = "low" | "mid" | "high";
export const toneOf = (pct: number): Tone => (pct < 50 ? "low" : pct < 80 ? "mid" : "high");

/** Bangkok wall-clock "now", in the same units as the parsed timestamps. */
export const wallNow = (real = Date.now()) => real + 7 * HOUR;

/**
 * "24/11/2569 09:21:45" -> wall-clock ms, or null if it can't be read.
 * Also takes the Gregorian year and a comma ("24/11/2026, 09:21:45"), which is how Google Sheets writes a typed or pasted date.
 */
export function parseStamp(ts: string): number | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(ts ?? "");
  if (!m) return null;
  const [d, mo, y, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  const ms = Date.UTC(y > 2400 ? y - 543 : y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? ms : null;
}

/** Share of a whole as a whole number. Never shows 100 until it is truly 100, nor 0 once there is one. */
export function pctOf(got: number, total: number) {
  if (!total || !got) return 0;
  if (got >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((got / total) * 100)));
}

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (ms: number) => `${pad(new Date(ms).getUTCHours())}:${pad(new Date(ms).getUTCMinutes())}`;
export const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543}`;
};
/** day without the year, for chart axes: 24/11 */
export const dayShort = (ms: number) => `${pad(new Date(ms).getUTCDate())}/${pad(new Date(ms).getUTCMonth() + 1)}`;

/** "3 นาทีที่แล้ว" style, from two wall-clock instants. */
export function ago(now: number, at: number) {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`;
  return `${Math.floor(hrs / 24)} วันที่แล้ว`;
}

export function tally(people: Person[], key: (p: Person) => string): Group[] {
  const map = new Map<string, { g: Group; last: number; unknown: number }>();
  for (const p of people) {
    const name = key(p);
    const e = map.get(name) ?? { g: { name, total: 0, got: 0 }, last: 0, unknown: 0 };
    e.g.total++;
    if (p.received) {
      e.g.got++;
      const at = parseStamp(p.receivedAt);
      if (at === null) e.unknown++;
      else e.last = Math.max(e.last, at);
    }
    map.set(name, e);
  }
  return [...map.values()].map(({ g, last, unknown }) => (g.total > 0 && g.got === g.total && !unknown && last ? { ...g, doneAt: last } : g));
}

/** A line of encouragement that follows how far along everyone is. */
export function cheerOf(got: number, total: number) {
  if (!total) return "";
  const pct = pctOf(got, total);
  if (pct >= 100) return "ส่งครบทุกคนแล้ว";
  if (pct >= 90) return "ส่งใกล้ครบแล้ว";
  if (pct >= 75) return "ส่งเกือบครบแล้ว";
  if (pct >= 50) return "คนส่งเกินครึ่งแล้ว";
  if (pct >= 25) return "กำลังส่งเรื่อยๆ";
  if (got > 0) return "เริ่มมีการส่งแล้ว";
  return "ยังไม่มีใครส่ง";
}

export function computeStats(people: Person[], now: number): Stats {
  const total = people.length;
  const received = people.filter((p) => p.received);
  const got = received.length;

  const stamped = received
    .map((p) => ({ p, at: parseStamp(p.receivedAt) }))
    .filter((x): x is { p: Person; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at);
  const untimed = got - stamped.length;
  const lastAt = stamped.length ? stamped[stamped.length - 1].at : null;

  const companies = tally(people, companyOf).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "th"));
  const depts = tally(people, deptOf);

  // timeline: cumulative count at the end of each hour (each day if the event spans more than a day and a half)
  let slotMs = HOUR;
  let start = 0;
  const points: Point[] = [];
  if (stamped.length) {
    const first = stamped[0].at;
    const end = Math.max(now, lastAt ?? now);
    if (end - first > 36 * HOUR) slotMs = DAY;
    start = Math.floor(first / slotMs) * slotMs;
    const slots = Math.floor((end - start) / slotMs) + 1;
    const counts = new Array<number>(slots).fill(0);
    for (const { at } of stamped) counts[Math.floor((at - start) / slotMs)]++;
    let cumulative = 0;
    for (let i = 0; i < slots; i++) {
      cumulative += counts[i];
      const from = start + i * slotMs;
      points.push({ from, at: Math.min(from + slotMs, end), added: counts[i], cumulative });
    }
  }

  return {
    total,
    got,
    pending: total - got,
    pct: pctOf(got, total),
    companies,
    depts,
    chiefs: allChiefs(people),
    doneDepts: depts.filter((d) => d.total > 0 && d.got === d.total).length,
    untimed,
    finished: depts.filter((d) => d.doneAt !== undefined).sort((a, b) => a.doneAt! - b.doneAt! || a.name.localeCompare(b.name, "th")),
    lastAt,
    lastHour: stamped.filter((x) => now - x.at < HOUR).length,
    recent: stamped
      .slice(-8)
      .reverse()
      .map(({ p, at }) => ({ row: p.row, code: p.code, name: p.name, nickname: p.nickname, company: p.company, dept: p.dept, at })),
    timeline: { slotMs, start, points },
  };
}

/** Rows that are received now but were not in the previous list (matched by row and code). */
export function newlyReceived(prev: Person[], next: Person[]): Person[] {
  const was = new Map(prev.map((p) => [p.row, p]));
  return next.filter((p) => {
    const old = was.get(p.row);
    return p.received && !!old && old.code === p.code && !old.received;
  });
}

const byBehind = (a: Group, b: Group) => b.total - b.got - (a.total - a.got) || b.total - a.total || a.name.localeCompare(b.name, "th");

/** Does this company have real Chief areas (two or more), or is Chief just the company's own name / blank? */
export function hasChiefLevel(people: Person[], company: string) {
  const seen = new Set<string>();
  for (const p of people) {
    if (companyOf(p) !== company) continue;
    seen.add(chiefOf(p));
    if (seen.size > 1) return true;
  }
  return false;
}

/** The Chief areas of one company, the ones furthest behind first. */
export const chiefGroups = (people: Person[], company: string): Group[] =>
  tally(people.filter((p) => companyOf(p) === company), chiefOf).sort(byBehind);

/** The departments inside a company (and a Chief, if given), the ones furthest behind first. */
export const deptGroups = (people: Person[], company: string, chief = ""): Group[] =>
  tally(people.filter((p) => companyOf(p) === company && (!chief || chiefOf(p) === chief)), deptOf).sort(byBehind);

/** Every Chief area across the companies that have them, for the dashboard. Prefixed with the company when more than one does. */
export function allChiefs(people: Person[]): Group[] {
  const withLevel = [...new Set(people.map(companyOf))].filter((c) => hasChiefLevel(people, c));
  const prefix = withLevel.length > 1;
  return withLevel.flatMap((c) => chiefGroups(people, c).map((g) => (prefix ? { ...g, name: `${c} · ${g.name}` } : g)));
}

/** Department rows in the order the reader wants them. */
export function sortDepts(depts: Group[], by: "pending" | "pct") {
  const pending = (g: Group) => g.total - g.got;
  const ratio = (g: Group) => (g.total ? g.got / g.total : 1);
  return [...depts].sort((a, b) => {
    const main = by === "pending" ? pending(b) - pending(a) : ratio(a) - ratio(b);
    return main || b.total - a.total || a.name.localeCompare(b.name, "th");
  });
}
