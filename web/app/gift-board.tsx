"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@/lib/people";

type Filter = "pending" | "got" | "all";
type Fx = "celebrate" | "remote" | "plain";

const LEAVE_MS = 420; // matches the .leaving collapse in globals.css
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const without = <T,>(o: Record<number, T>, k: number) => {
  const next = { ...o };
  delete next[k];
  return next;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const timeOf = (ts: string) => /(\d{1,2}:\d{2})/.exec(ts)?.[1] ?? "";
const shortTs = (ts: string) => ts.replace(/(\d{1,2}:\d{2}):\d{2}$/, "$1");
const photoSrc = (p: string) => `/api/photo?p=${encodeURIComponent(p)}`;

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `เกิดข้อผิดพลาด (${res.status})`, res.status);
  return data as T;
}

/** Shrink the photo before upload so it goes up fast on mobile data. */
function compress(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("แปลงรูปไม่สำเร็จ ให้ลองถ่ายใหม่"))), "image/jpeg", 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("เปิดไฟล์รูปนี้ไม่ได้ ให้ลองถ่ายใหม่"));
    };
    img.src = url;
  });
}

export default function GiftBoard({
  initialPeople,
  initialAdminName,
  loadedAt,
}: {
  initialPeople: Person[];
  initialAdminName: string | null;
  loadedAt: string;
}) {
  const [people, setPeople] = useState(initialPeople);
  const [adminName, setAdminName] = useState(initialAdminName);
  const [filter, setFilter] = useState<Filter>("pending");
  const [company, setCompany] = useState("");
  const [q, setQ] = useState("");
  const [currentRow, setCurrentRow] = useState<number | null>(null);
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "undo">("");
  const [toastMsg, setToastMsg] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(loadedAt);

  const isAdmin = !!adminName;
  const current = currentRow == null ? null : people.find((p) => p.row === currentRow) ?? null;

  const personDialog = useRef<HTMLDialogElement>(null);
  const loginDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  /* ---------- toast ---------- */
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  /* ---------- motion ---------- */
  const [fx, setFx] = useState<Record<number, Fx>>({});
  const [held, setHeld] = useState<Record<number, "stay" | "leaving">>({});
  const [shine, setShine] = useState(0); // bumps each time the received count goes up
  const [confetti, setConfetti] = useState(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  /** Highlight a row that just changed and keep it on screen a moment before it leaves a filtered list. */
  const mark = useCallback(
    (row: number, kind: Fx, holdMs: number) => {
      if (reducedMotion()) return;
      setFx((f) => ({ ...f, [row]: kind }));
      setHeld((h) => ({ ...h, [row]: "stay" }));
      later(() => setHeld((h) => (h[row] ? { ...h, [row]: "leaving" } : h)), holdMs);
      later(() => {
        setHeld((h) => without(h, row));
        setFx((f) => without(f, row));
      }, holdMs + LEAVE_MS);
    },
    [later]
  );

  /* ---------- data ---------- */
  const peopleRef = useRef(initialPeople);

  /** Every change to the list goes through here so the ribbon, confetti and row highlights can react. */
  const commit = useCallback(
    (next: Person[], fromServer = false) => {
      const prev = peopleRef.current;
      peopleRef.current = next;
      setPeople(next);
      if (reducedMotion()) return;

      const count = (list: Person[]) => list.filter((p) => p.received).length;
      const before = count(prev);
      const after = count(next);
      if (after > before) setShine((k) => k + 1);

      const wasDone = prev.length > 0 && before === prev.length;
      if (next.length > 0 && after === next.length && !wasDone) {
        setConfetti((k) => k + 1);
        later(() => setConfetti(0), 3800);
      }

      if (fromServer) {
        // rows another admin changed since our last look; a big batch (phone woke up) just updates quietly
        const old = new Map(prev.map((p) => [p.row, p]));
        const changed = next.filter((p) => {
          const o = old.get(p.row);
          return o && o.code === p.code && o.received !== p.received;
        });
        if (changed.length <= 6) changed.forEach((p) => mark(p.row, "remote", 1600));
      }
    },
    [later, mark]
  );

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ people: Person[]; adminName: string | null }>("/api/people");
      commit(data.people, true);
      setAdminName(data.adminName);
      setUpdatedAt(
        new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    } catch {
      /* keep showing the last data; next poll will retry */
    }
  }, [commit]);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) setAdminName(null);
      toast((e as Error).message);
    },
    [toast]
  );

  // keep several admins' phones in sync
  useEffect(() => {
    const tick = () => {
      if (document.hidden || busyRef.current || personDialog.current?.open || loginDialog.current?.open) return;
      refresh();
    };
    const id = setInterval(tick, 15000);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /* ---------- derived ---------- */
  const companies = useMemo(() => [...new Set(people.map((p) => p.company).filter(Boolean))], [people]);
  const scoped = useMemo(() => people.filter((p) => !company || p.company === company), [people, company]);
  const total = scoped.length;
  const got = scoped.filter((p) => p.received).length;
  const pct = total ? Math.round((got / total) * 100) : 0;

  const outOfFilter = useCallback(
    (p: Person) => (filter === "pending" && p.received) || (filter === "got" && !p.received),
    [filter]
  );

  const rows = useMemo(() => {
    const needle = norm(q);
    return scoped.filter((p) => {
      if (outOfFilter(p) && !held[p.row]) return false;
      if (!needle) return true;
      return [p.name, p.nickname, p.nickShort, p.code, p.dept, p.position].some((v) => norm(v).includes(needle));
    });
  }, [scoped, outOfFilter, held, q]);

  const emptyText = q
    ? `ไม่พบ "${q}" ลองค้นด้วยชื่อเล่นหรือรหัสพนักงาน`
    : filter === "pending"
      ? "ทุกคนส่งของขวัญครบแล้ว"
      : filter === "got"
        ? "ยังไม่มีใครส่งของขวัญ"
        : "ไม่มีรายชื่อในชีต";

  /* ---------- person sheet ---------- */
  const clearPending = useCallback(() => {
    setPending((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, []);

  const openPerson = (row: number) => {
    setCurrentRow(row);
    clearPending();
    personDialog.current?.showModal();
  };

  const closePerson = () => personDialog.current?.close();

  const pickPhoto = () => {
    if (!fileInput.current) return;
    fileInput.current.value = "";
    fileInput.current.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const blob = await compress(f);
      clearPending();
      setPending({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const replacePerson = (p: Person) => commit(peopleRef.current.map((x) => (x.row === p.row ? p : x)));

  const save = async () => {
    if (!current || !pending) return;
    const wasReceived = current.received;
    setBusy("save");
    try {
      const form = new FormData();
      form.set("row", String(current.row));
      form.set("code", current.code);
      form.set("photo", pending.blob, "gift.jpg");
      const { person } = await api<{ person: Person }>("/api/receive", { method: "POST", body: form });
      if (!wasReceived) mark(person.row, "celebrate", 900);
      replacePerson(person);
      closePerson();
      const who = person.nickname || person.name;
      toast(wasReceived ? `บันทึกรูปใหม่ของ ${who} แล้ว` : `รับของขวัญจาก ${who} แล้ว`);
    } catch (e) {
      handleError(e);
      if (e instanceof ApiError && e.status === 409) refresh();
    } finally {
      setBusy("");
    }
  };

  const undo = async () => {
    if (!current) return;
    const who = current.nickname || current.name;
    if (!confirm(`ยกเลิกการรับของขวัญของ ${who}?\nสถานะจะกลับเป็น "ยังไม่ส่ง"`)) return;
    setBusy("undo");
    try {
      const { person } = await api<{ person: Person }>("/api/unreceive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ row: current.row, code: current.code }),
      });
      mark(person.row, "plain", 150);
      replacePerson(person);
      closePerson();
      toast(`ยกเลิกการรับของ ${who} แล้ว`);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy("");
    }
  };

  /* ---------- login ---------- */
  const [loginErr, setLoginErr] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const openLogin = () => {
    setLoginErr("");
    setLoginOpen(true);
    loginDialog.current?.showModal();
  };

  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoggingIn(true);
    setLoginErr("");
    try {
      const res = await api<{ name: string }>("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      loginDialog.current?.close();
      setAdminName(res.name);
      toast(`เข้าสู่ระบบในชื่อ ${res.name}`);
      await refresh(); // pull admin-only fields (photos)
    } catch (err) {
      setLoginErr((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const onLogout = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    setAdminName(null);
    commit(peopleRef.current.map((p) => ({ ...p, photo: undefined, checkedBy: undefined })));
    toast("ออกจากระบบแล้ว");
  };

  /* ---------- render ---------- */
  const shotSrc = pending?.url ?? (current?.received && current.photo && isAdmin ? photoSrc(current.photo) : "");

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div>
              <h1>เช็คของขวัญ</h1>
              <p className="who">
                {isAdmin
                  ? `แอดมิน: ${adminName} แตะชื่อเพื่อถ่ายรูปและบันทึกการรับ`
                  : "ดูสถานะได้ทุกคน แอดมินเข้าสู่ระบบเพื่อบันทึกการรับ"}
              </p>
            </div>
            <button className="link-btn" type="button" onClick={isAdmin ? onLogout : openLogin}>
              {isAdmin ? "ออกจากระบบ" : "เข้าสู่ระบบแอดมิน"}
            </button>
          </div>

          <div className="tally">
            <div className="tally-line">
              <span key={shine} className={`tally-done${shine ? " bump" : ""}`}>
                {got}
              </span>
              <span className="tally-of">จากทั้งหมด {total} คน ส่งของขวัญแล้ว</span>
              <span className="tally-pct">{pct}%</span>
            </div>
            <div className="ribbon-wrap">
              <div
                className={`ribbon${total > 0 && got === total ? " full" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="สัดส่วนคนที่ส่งของขวัญแล้ว"
              >
                <div className="ribbon-fill" style={{ width: `${pct}%` }}>
                  {shine > 0 && <span key={shine} className="ribbon-shine" />}
                </div>
              </div>
              {total > 0 && got === total && <Bow />}
            </div>
          </div>

          <div className="controls">
            <input
              className="search"
              type="search"
              placeholder="ค้นหาชื่อ หรือรหัส"
              autoComplete="off"
              aria-label="ค้นหา"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="company" aria-label="กรองตามบริษัท" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">ทุกบริษัท</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="seg" role="tablist" aria-label="กรองตามสถานะ">
              {(
                [
                  ["pending", "ยังไม่ส่ง", total - got],
                  ["got", "ส่งแล้ว", got],
                  ["all", "ทั้งหมด", total],
                ] as const
              ).map(([key, label, n]) => (
                <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
                  {label} <span className="n">{n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main>
        <ul className="list">
          {rows.map((p) => (
            <li key={p.row} className={held[p.row] === "leaving" && outOfFilter(p) ? "leaving" : undefined}>
              <div>
                <button
                  type="button"
                  className={`row${isAdmin ? " admin" : ""}${p.received ? " got" : ""}${fx[p.row] ? ` ${fx[p.row]}` : ""}`}
                  onClick={() => openPerson(p.row)}
                >
                  <span className="who-col">
                    <span className="nick">{p.nickname || p.name}</span>
                    <span className="full">{p.name}</span>
                    <span className="meta">
                      {p.position}
                      {p.company ? `, ${p.company}` : ""}
                    </span>
                  </span>
                  <span className="mark">
                    {p.received ? (
                      <>
                        <span className="dot" aria-hidden="true">
                          <CheckIcon />
                        </span>
                        ส่งแล้ว {timeOf(p.receivedAt)}
                      </>
                    ) : isAdmin ? (
                      <>
                        <span className="dot" aria-hidden="true">
                          <CameraIcon size={16} stroke={2.2} />
                        </span>
                        รับของ
                      </>
                    ) : (
                      <>
                        <span className="dot" aria-hidden="true" />
                        ยังไม่ส่ง
                      </>
                    )}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!rows.length && (
          <div className="empty">
            {filter === "pending" && !q && total > 0 && got === total && <GiftDone />}
            <p>{emptyText}</p>
          </div>
        )}
        {updatedAt && <p className="updated">อัปเดตล่าสุด {updatedAt}</p>}
      </main>

      {/* person / photo sheet */}
      <dialog
        ref={personDialog}
        aria-labelledby="pName"
        onClose={() => {
          setCurrentRow(null);
          clearPending();
        }}
        onCancel={(e) => busy && e.preventDefault()}
        onClick={(e) => e.target === e.currentTarget && !busy && closePerson()}
      >
        {current && (
          <div className="sheet-body">
            <div className="grab" />
            <div className="sheet-head">
              <div>
                <h2 id="pName">{current.nickname || current.name}</h2>
                <span className={`status-pill${current.received ? " got" : ""}`}>
                  {current.received ? "ส่งของขวัญแล้ว" : "ยังไม่ส่งของขวัญ"}
                </span>
              </div>
              <button className="close" type="button" aria-label="ปิด" onClick={closePerson} disabled={!!busy}>
                ✕
              </button>
            </div>
            <div className="facts">
              <p>{current.name}</p>
              <p>
                {current.position}
                {current.dept ? `, ${current.dept}` : ""}
              </p>
              <p>
                {current.company} รหัสพนักงาน {current.code}
              </p>
            </div>

            {isAdmin ? (
              <>
                <button type="button" className={`shot${shotSrc ? " has" : ""}`} onClick={pickPhoto} disabled={!!busy}>
                  {shotSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shotSrc} alt={`รูปของขวัญจาก ${current.nickname || current.name}`} />
                  ) : (
                    <span>
                      <CameraIcon size={40} stroke={1.6} />
                      <strong>{current.received ? "แตะเพื่อถ่ายรูปใหม่" : "แตะเพื่อถ่ายรูปของขวัญ"}</strong>
                      ถ่ายให้เห็นของขวัญชัด ๆ
                    </span>
                  )}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={onFile}
                />
                {current.received && (
                  <p className="received-note">
                    รับเมื่อ {shortTs(current.receivedAt)}
                    {current.checkedBy ? ` โดย ${current.checkedBy}` : ""}
                  </p>
                )}
                <div className="actions">
                  {pending ? (
                    <>
                      <button className="btn btn-quiet" type="button" onClick={pickPhoto} disabled={!!busy}>
                        ถ่ายใหม่
                      </button>
                      <button className="btn btn-primary" type="button" onClick={save} disabled={!!busy}>
                        {busy === "save" ? "กำลังบันทึก..." : current.received ? "บันทึกรูปใหม่" : "ยืนยันรับของขวัญ"}
                      </button>
                    </>
                  ) : current.received ? (
                    <>
                      <button className="btn btn-danger" type="button" onClick={undo} disabled={!!busy}>
                        {busy === "undo" ? "กำลังยกเลิก..." : "ยกเลิกการรับ"}
                      </button>
                      <button className="btn btn-quiet" type="button" onClick={pickPhoto} disabled={!!busy}>
                        ถ่ายรูปใหม่
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" type="button" onClick={pickPhoto}>
                      ถ่ายรูปของขวัญ
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="received-note">
                {current.received ? `ส่งเมื่อ ${shortTs(current.receivedAt)}` : "บันทึกการรับได้เฉพาะแอดมิน"}
              </p>
            )}
          </div>
        )}
      </dialog>

      {/* login */}
      <dialog ref={loginDialog} aria-labelledby="loginTitle" onClose={() => setLoginOpen(false)}
        onClick={(e) => e.target === e.currentTarget && loginDialog.current?.close()}>
        {loginOpen && (
          <form className="sheet-body" onSubmit={onLogin}>
            <div className="grab" />
            <div className="sheet-head">
              <h2 id="loginTitle">เข้าสู่ระบบแอดมิน</h2>
              <button className="close" type="button" aria-label="ปิด" onClick={() => loginDialog.current?.close()}>
                ✕
              </button>
            </div>
            <div style={{ height: 14 }} />
            <label className="field">
              <span>ชื่อผู้ใช้</span>
              <input name="username" autoComplete="username" autoCapitalize="off" required autoFocus />
            </label>
            <label className="field">
              <span>รหัสผ่าน</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <p className="error" role="alert">
              {loginErr}
            </p>
            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={loggingIn}>
                {loggingIn ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </button>
            </div>
          </form>
        )}
      </dialog>

      <div className={`toast${toastMsg ? " show" : ""}`} role="status" aria-live="polite">
        {toastMsg}
      </div>

      {confetti > 0 && <Confetti key={confetti} />}
    </>
  );
}

/** Tied on the end of the ribbon once everyone has handed in a gift. */
function Bow() {
  return (
    <svg className="bow" width="44" height="32" viewBox="0 0 44 32" aria-hidden="true">
      <path d="M22 15C18 4 4 2 5 11c.7 6.5 10 7 17 4z" fill="var(--ribbon)" />
      <path d="M22 15C26 4 40 2 39 11c-.7 6.5-10 7-17 4z" fill="var(--ribbon)" />
      <path d="M8 9.5c3 0 8 2 11.5 4.5M36 9.5c-3 0-8 2-11.5 4.5" stroke="var(--ribbon-deep)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M20.5 16 14 29l3.6-1.2L19 31l4-14z" fill="var(--ribbon-deep)" />
      <path d="M23.5 16 30 29l-3.6-1.2L25 31l-4-14z" fill="var(--ribbon-deep)" />
      <rect x="18.5" y="11.5" width="7" height="7" rx="2.2" fill="var(--ribbon-deep)" />
    </svg>
  );
}

/** Shown in the "ยังไม่ส่ง" tab once it is empty because everyone is done. */
function GiftDone() {
  return (
    <svg className="done-art" width="112" height="112" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256 214C232 146 152 124 150 182c-1 40 56 48 106 32z" fill="var(--ribbon)" />
      <path d="M256 214C280 146 360 124 362 182c1 40-56 48-106 32z" fill="var(--ribbon)" />
      <path d="M176 176c22 2 52 16 72 32M336 176c-22 2-52 16-72 32" stroke="var(--ribbon-deep)" strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x="112" y="214" width="288" height="64" rx="16" fill="var(--ribbon)" />
      <rect x="136" y="286" width="240" height="140" rx="14" fill="var(--ribbon)" />
      <rect x="238" y="214" width="36" height="212" fill="#fff" />
      <rect x="226" y="196" width="60" height="38" rx="12" fill="var(--ribbon-deep)" />
    </svg>
  );
}

const CONFETTI_COLORS =["#D4243B", "#0F7B5F", "#E8B031", "#16213A", "#F28C9B"];
// fixed pseudo-random layout so rendering stays pure
const CONFETTI = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 44 }, (_, i) => ({
    x: rnd() * 100,
    dx: (rnd() - 0.5) * 30,
    r: rnd() * 360,
    d: 1.9 + rnd() * 1.2,
    delay: rnd() * 0.5,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 4 === 0,
  }));
})();

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className={c.round ? "round" : undefined}
          style={
            {
              "--x": `${c.x}%`,
              "--dx": `${c.dx}vw`,
              "--r": `${c.r}deg`,
              "--d": `${c.d}s`,
              "--delay": `${c.delay}s`,
              "--c": c.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CameraIcon({ size, stroke }: { size: number; stroke: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.3-2h7l1.3 2h1.7A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.8" />
    </svg>
  );
}
