"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@/lib/people";
import PhotoViewer from "./photo-viewer";
import CompanyPicker from "./company-picker";
import { Confetti } from "./effects";
import HomeTab from "./home-tab";
import DrillSheet, { type Drill } from "./drill-sheet";
import { attachSheetDrag, markScrollable } from "./sheet-drag";
import { companyOf, inScope, NO_SCOPE, pctOf, shownChief, type Scope } from "@/lib/stats";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChartIcon, HomeIcon, ListIcon } from "./tab-icons";

type Filter = "pending" | "got" | "all";
type Tab = "home" | "list";
type Fx = "celebrate" | "remote" | "plain";

const LEAVE_MS = 420; // matches the .leaving collapse in globals.css
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const without = <T,>(o: Record<number, T>, k: number) => {
  const next = { ...o };
  delete next[k];
  return next;
};

/** Slide a sheet away, then close it (Escape and the Android back button still close it at once). */
function closeSheet(d: HTMLDialogElement | null) {
  if (!d?.open || d.dataset.closing) return;
  if (reducedMotion()) return d.close();
  const token = String(Math.random());
  d.dataset.closing = token;
  const done = () => {
    if (d.dataset.closing !== token) return;
    d.removeEventListener("animationend", onEnd);
    delete d.dataset.closing;
    if (d.open) d.close();
  };
  const onEnd = (e: AnimationEvent) => e.target === d && done();
  d.addEventListener("animationend", onEnd);
  setTimeout(done, 400); // if the animation never runs
}

function openSheet(d: HTMLDialogElement | null) {
  if (!d) return;
  delete d.dataset.closing;
  if (!d.open) d.showModal();
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const timeOf = (ts: string) => /(\d{1,2}:\d{2})/.exec(ts)?.[1] ?? "";
const dateOf = (ts: string) => /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(ts)?.[1] ?? "";
const shortTs = (ts: string) => ts.replace(/(\d{1,2}:\d{2}):\d{2}$/, "$1");
const photoSrc = (p: string) => `/api/photo?p=${encodeURIComponent(p)}`;
/** The letter in a person's avatar: the first letter of the nickname, past titles like "คุณ" and leading vowels. */
const initialOf = (s: string) => Array.from(s.replace(/^(คุณ|นาย|นางสาว|นาง|น\.ส\.)\s*/, "").replace(/^[เแโใไ]+/, "").trim())[0] ?? "•";

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
  const [scope, setScope] = useState<Scope>(NO_SCOPE); // which company / Chief / department the list is narrowed to
  const wantedTab = useSearchParams().get("tab"); // the overview page's tab bar links back here with ?tab=home / ?tab=list
  const [tab, setTab] = useState<Tab>(
    wantedTab === "home" || wantedTab === "list" ? wantedTab : initialAdminName ? "list" : "home", // admins are here to record gifts; everyone else to see how it is going
  );
  // the page is kept alive while the overview is open, so its state outlives the visit: follow the link's tab every time we come back
  useEffect(() => {
    if (wantedTab === "home" || wantedTab === "list") setTab(wantedTab);
  }, [wantedTab]);
  const [drill, setDrill] = useState<Drill | null>(null);
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
  const photoDialog = useRef<HTMLDialogElement>(null);
  const drillDialog = useRef<HTMLDialogElement>(null);
  const [badSrc, setBadSrc] = useState("");
  const toastEl = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [stuck, setStuck] = useState(false);
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

  // the toast lives in the top layer so it shows above an open sheet (e.g. an upload error)
  useEffect(() => {
    const el = toastEl.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (toastMsg) {
      if (el.matches(":popover-open")) el.hidePopover(); // re-raise above a sheet opened since
      el.showPopover();
      return;
    }
    const id = setTimeout(() => el.matches(":popover-open") && el.hidePopover(), 250);
    return () => clearTimeout(id);
  }, [toastMsg]);

  /* ---------- phone niceties ---------- */
  // shadow under the search bar once it sticks to the top
  useEffect(() => {
    const s = sentinel.current;
    if (!s) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, [tab]);

  /** After changing a filter while scrolled down, start the list right under the search bar. */
  const jumpToList = () => {
    // wait for the new list to render, otherwise scroll anchoring moves us again
    requestAnimationFrame(() => {
      const list = listRef.current;
      const dock = dockRef.current;
      if (!list || !dock) return;
      const top = list.getBoundingClientRect().top + window.scrollY - dock.offsetHeight - 8;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
    });
  };

  // both bottom sheets close by dragging them down from anywhere (see sheet-drag.ts)
  useEffect(() => {
    const d = personDialog.current;
    return d ? attachSheetDrag(d, () => !!busyRef.current) : undefined;
  }, []);
  useEffect(() => {
    const d = drillDialog.current;
    return d ? attachSheetDrag(d, () => false) : undefined;
  }, []);

  // a sheet taller than the screen has to scroll, so it can't also be dragged from its middle
  useEffect(() => {
    const check = () => {
      markScrollable(personDialog.current);
      markScrollable(drillDialog.current);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  });

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

  // errors while a sheet is open show inside it: everything behind a modal sheet is inert
  const [sheetErr, setSheetErr] = useState("");
  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) setAdminName(null);
      const msg = (e as Error).message;
      if (personDialog.current?.open) setSheetErr(msg);
      else toast(msg);
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
  const companies = useMemo(() => [...new Set(people.map(companyOf))], [people]);
  const companyOptions = useMemo(
    () => [
      { value: "", label: "ทุกบริษัท", count: people.length },
      ...companies.map((c) => ({ value: c, label: c, count: people.filter((p) => companyOf(p) === c).length })),
    ],
    [companies, people]
  );
  const scoped = useMemo(() => people.filter((p) => inScope(p, scope)), [people, scope]);
  const scopeLabel = [scope.company, scope.chief, scope.dept].filter(Boolean).join(" / ");
  const total = scoped.length;
  const got = scoped.filter((p) => p.received).length;
  const pct = pctOf(got, total);

  const outOfFilter = useCallback(
    (p: Person) => (filter === "pending" && p.received) || (filter === "got" && !p.received),
    [filter]
  );

  const rows = useMemo(() => {
    const needle = norm(q);
    return scoped.filter((p) => {
      if (outOfFilter(p) && !held[p.row]) return false;
      if (!needle) return true;
      return [p.name, p.nickname, p.nickShort, p.code, p.company, p.chief, p.dept, p.position].some((v) => norm(v).includes(needle));
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
    setSheetErr("");
    openSheet(personDialog.current);
  };

  const closePerson = () => closeSheet(personDialog.current);

  const pickPhoto = () => {
    setSheetErr("");
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
      setSheetErr((err as Error).message);
    }
  };

  const replacePerson = (p: Person) => commit(peopleRef.current.map((x) => (x.row === p.row ? p : x)));

  const save = async () => {
    if (!current || !pending) return;
    const wasReceived = current.received;
    setBusy("save");
    setSheetErr("");
    try {
      const form = new FormData();
      form.set("row", String(current.row));
      form.set("code", current.code);
      form.set("photo", pending.blob, "gift.jpg");
      const { person } = await api<{ person: Person }>("/api/receive", { method: "POST", body: form });
      if (!wasReceived) mark(person.row, "celebrate", 900);
      replacePerson(person);
      closePerson();
      navigator.vibrate?.(18); // a small tick on Android
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
    setSheetErr("");
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

  /* ---------- home: opening a company, going to the list ---------- */
  const openDrill = (company: string) => {
    setDrill({ company, chief: "" });
    openSheet(drillDialog.current);
  };
  const goList = (next: Scope) => {
    closeSheet(drillDialog.current);
    setScope(next);
    setFilter("all"); // everyone in that group, so both who has sent and who has not are in view
    setQ("");
    setTab("list");
    window.scrollTo({ top: 0 });
  };
  const switchTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  /* ---------- login ---------- */
  const [loginErr, setLoginErr] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const openLogin = () => {
    setLoginErr("");
    setLoginOpen(true);
    openSheet(loginDialog.current);
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
      closeSheet(loginDialog.current);
      setAdminName(res.name);
      setTab("list"); // an admin who just signed in wants the people to record, not the summary
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
  const shotOk = !!shotSrc && shotSrc !== badSrc; // false when the saved photo failed to load

  return (
    <>
      <header className="appbar">
        <div className="wrap">
          <div className="bar">
            <span className="logo" aria-hidden="true">
              <GiftIcon />
            </span>
            <div className="bar-t">
              <h1>เช็คของขวัญ</h1>
              <p className="who">{isAdmin ? `แอดมิน: ${adminName}` : "ดูสถานะได้ทุกคน"}</p>
            </div>
            <button className="link-btn" type="button" onClick={isAdmin ? onLogout : openLogin}>
              {isAdmin ? "ออกจากระบบ" : "เข้าสู่ระบบแอดมิน"}
            </button>
          </div>
        </div>
      </header>

      {tab === "home" ? (
        <HomeTab people={people} shine={shine} onCompany={openDrill} />
      ) : (
        <>
          <div ref={sentinel} aria-hidden="true" />
          <div ref={dockRef} className={`dock${stuck ? " stuck" : ""}`}>
            <div className="wrap">
              <div className="controls">
                <input
                  className="search"
                  type="search"
                  enterKeyHint="search"
                  placeholder="ค้นหาชื่อ รหัส หรือหน่วยงาน"
                  autoComplete="off"
                  aria-label="ค้นหา"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    jumpToList();
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <CompanyPicker
                  label="กรองตามบริษัท"
                  value={scope.company}
                  options={companyOptions}
                  onChange={(v) => {
                    setScope({ company: v, chief: "", dept: "" });
                    jumpToList();
                  }}
                />
                <div className="seg" role="tablist" aria-label="กรองตามสถานะ">
                  {(
                    [
                      ["pending", "ยังไม่ส่ง", total - got],
                      ["got", "ส่งแล้ว", got],
                      ["all", "ทั้งหมด", total],
                    ] as const
                  ).map(([key, label, n]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={filter === key}
                      onClick={() => {
                        setFilter(key);
                        jumpToList();
                      }}
                    >
                      {label} <span className="n">{n}</span>
                    </button>
                  ))}
                </div>
                {(scope.chief || scope.dept) && (
                  <button
                    type="button"
                    className="scope-chip"
                    onClick={() => {
                      setScope(NO_SCOPE);
                      jumpToList();
                    }}
                    aria-label={`ล้างตัวกรอง ${scopeLabel}`}
                  >
                    <span>{scopeLabel}</span>
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </div>
            </div>
            <div className="dock-progress" style={{ width: `${pct}%` }} aria-hidden="true" />
          </div>

          <main className="list-main">
            {isAdmin && <p className="admin-hint">แตะชื่อเพื่อถ่ายรูปและบันทึกการรับ</p>}
            <ul className="list" ref={listRef}>
              {rows.map((p) => (
                <li key={p.row} className={held[p.row] === "leaving" && outOfFilter(p) ? "leaving" : undefined}>
                  <div>
                    <button
                      type="button"
                      className={`row${isAdmin ? " admin" : ""}${p.received ? " got" : ""}${fx[p.row] ? ` ${fx[p.row]}` : ""}`}
                      onClick={() => openPerson(p.row)}
                    >
                      <span className="av" aria-hidden="true">
                        {initialOf(p.nickname || p.name)}
                      </span>
                      <span className="who-col">
                        <span className="nick">{p.nickname || p.name}</span>
                        <span className="full">{p.name}</span>
                        <span className="meta">{[p.company, p.dept].filter(Boolean).join(" / ")}</span>
                      </span>
                      <span className="mark">
                        {p.received ? (
                          <ReceivedMark p={p} />
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
        </>
      )}

      <nav className="tabbar" aria-label="เมนูหลัก">
        <div className="tabbar-in">
          <button type="button" className={tab === "home" ? "on" : undefined} aria-current={tab === "home" ? "page" : undefined} onClick={() => switchTab("home")}>
            <HomeIcon />
            หน้าหลัก
          </button>
          <button type="button" className={tab === "list" ? "on" : undefined} aria-current={tab === "list" ? "page" : undefined} onClick={() => switchTab("list")}>
            <ListIcon />
            รายชื่อ
          </button>
          <Link href="/dashboard">
            <ChartIcon />
            ภาพรวม
          </Link>
        </div>
      </nav>

      {/* person / photo sheet */}
      <dialog
        ref={personDialog}
        className="sheet-person"
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
            <div className="grab" data-drag />
            <div className="sheet-head" data-drag>
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
                {current.company}
                {shownChief(current) ? ` / ${shownChief(current)}` : ""} รหัสพนักงาน {current.code}
              </p>
            </div>

            {isAdmin ? (
              <>
                <button
                  type="button"
                  className={`shot${shotOk ? " has" : ""}`}
                  onClick={shotOk ? () => photoDialog.current?.showModal() : pickPhoto}
                  disabled={!!busy}
                >
                  {shotOk ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shotSrc}
                        alt={`รูปของขวัญจาก ${current.nickname || current.name}`}
                        draggable={false}
                        onError={() => setBadSrc(shotSrc)}
                      />
                      <span className="zoom-hint">แตะเพื่อดูรูป</span>
                    </>
                  ) : shotSrc ? (
                    <span>
                      <CameraIcon size={40} stroke={1.6} />
                      <strong>เปิดรูปนี้ไม่ได้</strong>
                      แตะเพื่อถ่ายรูปใหม่
                    </span>
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
                {sheetErr && (
                  <p className="sheet-error" role="alert">
                    {sheetErr}
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
      <dialog
        ref={loginDialog}
        className="login-sheet"
        aria-labelledby="loginTitle"
        onClose={() => setLoginOpen(false)}
        onClick={(e) => e.target === e.currentTarget && closeSheet(loginDialog.current)}
      >
        {loginOpen && (
          <form className="sheet-body" onSubmit={onLogin}>
            <div className="sheet-head">
              <h2 id="loginTitle">เข้าสู่ระบบแอดมิน</h2>
              <button className="close" type="button" aria-label="ปิด" onClick={() => closeSheet(loginDialog.current)}>
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

      {/* company -> Chief -> department drill-down, opened from the home tab */}
      <dialog
        ref={drillDialog}
        className="sheet-drill"
        aria-labelledby="drillTitle"
        onClick={(e) => e.target === e.currentTarget && closeSheet(drillDialog.current)}
      >
        {drill && (
          <DrillSheet
            people={people}
            drill={drill}
            onChief={(chief) => setDrill((d) => d && { ...d, chief })}
            onBack={() => setDrill((d) => d && { ...d, chief: "" })}
            onList={goList}
            onClose={() => closeSheet(drillDialog.current)}
          />
        )}
      </dialog>

      <PhotoViewer
        dialogRef={photoDialog}
        src={shotOk ? shotSrc : ""}
        alt={`รูปของขวัญจาก ${current?.nickname || current?.name || ""}`}
      />

      <div ref={toastEl} popover="manual" className={`toast${toastMsg ? " show" : ""}`} role="status" aria-live="polite">
        {toastMsg}
      </div>

      {confetti > 0 && <Confetti key={confetti} />}
    </>
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

/** The right-hand mark of a row that has been received: who recorded it (admins only), the date and the time. */
function ReceivedMark({ p }: { p: Person }) {
  const date = dateOf(p.receivedAt);
  const time = timeOf(p.receivedAt);
  const bare = !p.checkedBy && !date && !time; // an old row with nothing recorded but the status
  return (
    <>
      <span className="dot" aria-hidden="true">
        <GiftIcon size={17} stroke={2} />
      </span>
      {bare ? <span>ส่งแล้ว</span> : <span className="sr-only">ส่งแล้ว</span>}
      {p.checkedBy && <span className="mark-name">{p.checkedBy}</span>}
      {(date || time) && (
        <span className="mark-when">
          {date && <span>{date}</span>} {time && <span>{time}</span>}
        </span>
      )}
    </>
  );
}

function GiftIcon({ size = 22, stroke = 1.9 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
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
