"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@/lib/people";

type Filter = "pending" | "got" | "all";

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


  /* ---------- data ---------- */
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ people: Person[]; adminName: string | null }>("/api/people");
      setPeople(data.people);
      setAdminName(data.adminName);
      setUpdatedAt(
        new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    } catch {
      /* keep showing the last data; next poll will retry */
    }
  }, []);

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

  const rows = useMemo(() => {
    const needle = norm(q);
    return scoped.filter((p) => {
      if (filter === "pending" && p.received) return false;
      if (filter === "got" && !p.received) return false;
      if (!needle) return true;
      return [p.name, p.nickname, p.nickShort, p.code, p.dept, p.position].some((v) => norm(v).includes(needle));
    });
  }, [scoped, filter, q]);

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

  const replacePerson = (p: Person) => setPeople((list) => list.map((x) => (x.row === p.row ? p : x)));

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
    setPeople((list) => list.map((p) => ({ ...p, photo: undefined, checkedBy: undefined })));
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
              <span className="tally-done">{got}</span>
              <span className="tally-of">จากทั้งหมด {total} คน ส่งของขวัญแล้ว</span>
              <span className="tally-pct">{pct}%</span>
            </div>
            <div
              className="ribbon"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label="สัดส่วนคนที่ส่งของขวัญแล้ว"
            >
              <div className="ribbon-fill" style={{ width: `${pct}%` }} />
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
            <li key={p.row}>
              <button
                type="button"
                className={`row${isAdmin ? " admin" : ""}${p.received ? " got" : ""}`}
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
            </li>
          ))}
        </ul>
        {!rows.length && <p className="empty">{emptyText}</p>}
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
    </>
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
