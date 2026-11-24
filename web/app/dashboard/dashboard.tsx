"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Person } from "@/lib/people";
import { ago, cheerOf, clock, computeStats, dayOf, dayShort, newlyReceived, pctOf, sortDepts, wallNow, type Group, type Stats } from "@/lib/stats";
import { Confetti, EmptyGift } from "../effects";
import { useCountUp } from "../use-count-up";
import { ChartIcon, HomeIcon, ListIcon } from "../tab-icons";
import TimelineChart from "./timeline-chart";

type View = "chart" | "table";
type DeptSort = "pending" | "pct";
type Dim = "chief" | "dept";
const DEPT_ROWS = 8;
const CHIEF_ROWS = 12; // a company has a handful of Chief areas: show them all rather than hide one behind a button
const EMPHASIZED = 3; // how many of the furthest-behind departments stand out
const DAY = 86_400_000;
const STAGE = { w: 1600, h: 900 }; // the fixed canvas the big-screen mode is laid out on, then scaled to the screen

const stamp = (ms: number) => `${clock(ms)}:${String(new Date(ms).getUTCSeconds()).padStart(2, "0")}`;
function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

export default function Dashboard({ initialPeople, asOf }: { initialPeople: Person[]; asOf: number }) {
  const params = useSearchParams();
  const [people, setPeople] = useState(initialPeople);
  const [now, setNow] = useState(asOf); // wall-clock "now"; starts as the server's so the first paint matches
  const [updated, setUpdated] = useState(asOf);
  const [view, setView] = useState<View>("chart");
  const [deptSort, setDeptSort] = useState<DeptSort>("pending");
  const [allDepts, setAllDepts] = useState(false);
  const [dimChoice, setDimChoice] = useState<Dim | null>(null);
  const [tv, setTv] = useState(() => params.get("tv") === "1");

  // what just happened, for the celebration layer
  const [fresh, setFresh] = useState<number[]>([]); // rows received since the last pull
  const [bump, setBump] = useState(0);
  const [announce, setAnnounce] = useState<{ key: number; text: string } | null>(null);
  const [party, setParty] = useState(0);
  const lastPeople = useRef(initialPeople);
  const timers = useRef<number[]>([]);
  const wasComplete = useRef(initialPeople.length > 0 && initialPeople.every((p) => p.received));

  // the same rhythm as the list page: pull fresh data every 15 s while the page is visible
  useEffect(() => {
    let alive = true;
    const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
    const pull = async () => {
      try {
        const res = await fetch("/api/people", { cache: "no-store" });
        if (!res.ok) return;
        const next = ((await res.json()) as { people: Person[] }).people;
        if (!alive) return;
        const added = newlyReceived(lastPeople.current, next);
        lastPeople.current = next;
        setPeople(next);
        setNow(wallNow());
        setUpdated(wallNow());
        if (!added.length) return;
        setBump((k) => k + 1);
        setFresh(added.map((p) => p.row));
        later(() => setFresh([]), 6000);
        const everyone = next.length > 0 && next.every((p) => p.received);
        if (everyone && !wasComplete.current) {
          setParty((k) => k + 1);
          later(() => setParty(0), 3800);
        }
        wasComplete.current = everyone;
        if (added.length <= 5) {
          const who = added.length === 1 ? `${added[0].nickname || added[0].name} ส่งของขวัญแล้ว` : `มีคนส่งของขวัญเพิ่ม ${added.length} คน`;
          setAnnounce({ key: Date.now(), text: everyone ? "ครบทุกคนแล้ว" : who });
          later(() => setAnnounce(null), 6000);
        }
      } catch {
        /* keep what is on screen; the next pull retries */
      }
    };
    const id = setInterval(() => !document.hidden && pull(), 15000);
    const onVisible = () => !document.hidden && pull();
    document.addEventListener("visibilitychange", onVisible);
    const pending = timers.current;
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      pending.forEach(clearTimeout);
    };
  }, []);

  // keep "3 minutes ago" honest between pulls
  useEffect(() => {
    const id = setInterval(() => setNow(wallNow()), 30000);
    return () => clearInterval(id);
  }, []);

  /* ---------- big-screen mode ---------- */
  const fullscreen = useRef(false);
  const enterTv = () => {
    setTv(true);
    // asked for inside the click, as browsers require; where it isn't available the overlay alone still works
    document.documentElement.requestFullscreen?.().then(() => (fullscreen.current = true)).catch(() => {});
  };
  const exitTv = () => {
    setTv(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    fullscreen.current = false;
  };
  useEffect(() => {
    if (!tv) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exitTv();
    const onFs = () => {
      if (!document.fullscreenElement && fullscreen.current) exitTv(); // left full screen with the browser's own Esc
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);

    // keep the screen awake while it is on show
    let lock: { release(): Promise<void> } | null = null;
    const hold = () => navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    hold();
    const onVis = () => !document.hidden && hold();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [tv]);

  const st = useMemo(() => computeStats(people, now), [people, now]);
  // by Chief when the sheet has them (it is the level a manager answers for), otherwise by department
  const hasChiefs = st.chiefs.length > 0;
  const dim: Dim = hasChiefs && dimChoice !== "dept" ? "chief" : "dept";
  const depts = useMemo(() => sortDepts(dim === "chief" ? st.chiefs : st.depts, deptSort), [dim, st.chiefs, st.depts, deptSort]);
  const rowLimit = dim === "chief" ? CHIEF_ROWS : DEPT_ROWS;
  const shownDepts = allDepts ? depts : depts.slice(0, rowLimit);
  const dimWord = dim === "chief" ? "Chief" : "หน่วยงาน";
  const dimTitle = dim === "chief" ? "แยกตาม Chief" : "แยกตามหน่วยงาน";
  const dimAll = dim === "chief" ? "ดูครบทุก Chief" : "ดูครบทุกหน่วยงาน";
  const complete = st.total > 0 && st.got === st.total;

  const hero = <Hero st={st} now={now} bump={bump} complete={complete} />;

  return (
    <>
      {tv ? (
        <TvView st={st} now={now} updated={updated} asOf={asOf} fresh={fresh} bump={bump} complete={complete} onExit={exitTv} />
      ) : (
        <div className="dash">
          <header className="appbar">
            <div className="dash-wrap">
              <div className="bar">
                <span className="logo" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
                  </svg>
                </span>
                <div className="bar-t">
                  <h1>เช็คของขวัญ</h1>
                  <p className="who">อัปเดตล่าสุด {stamp(updated)} · ดึงข้อมูลใหม่ทุก 15 วินาที</p>
                </div>
              </div>
              <div className="dash-titlebar">
                <h2 className="home-hello">ภาพรวม</h2>
                <div className="dash-tools">
                  <button type="button" className="tv-btn" onClick={enterTv}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                    </svg>
                    โหมดจอใหญ่
                  </button>
                  <div className="dash-seg" role="group" aria-label="รูปแบบการแสดงผล">
                    {(
                      [
                        ["chart", "กราฟ"],
                        ["table", "ตาราง"],
                      ] as const
                    ).map(([key, label]) => (
                      <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="dash-main">
            {st.total === 0 ? (
              <p className="empty">ยังไม่มีรายชื่อในชีต</p>
            ) : (
              <div className="dash-grid">
                {hero}

                <section className="card span-5" aria-labelledby="h-co">
                  <h2 id="h-co" className="card-title">
                    แยกตามบริษัท
                  </h2>
                  {view === "chart" ? <MeterList groups={st.companies} variant="co" /> : <GroupTable groups={st.companies} first="บริษัท" />}
                </section>

                <section className="card span-7" aria-labelledby="h-tl">
                  <h2 id="h-tl" className="card-title">
                    จำนวนคนที่ส่งแล้ว (สะสม) ตามเวลา
                  </h2>
                  {st.timeline.points.length === 0 ? (
                    <EmptyGift title="ยังไม่มีใครส่งของขวัญ" hint="กราฟจะเริ่มขึ้นเมื่อมีคนแรกส่ง" />
                  ) : view === "chart" ? (
                    <TimelineChart timeline={st.timeline} total={st.total} />
                  ) : (
                    <TimelineTable timeline={st.timeline} />
                  )}
                  {st.untimed > 0 && <p className="card-foot">มี {st.untimed} คนที่บันทึกว่าส่งแล้วแต่ไม่มีเวลา จึงไม่อยู่ในส่วนนี้</p>}
                </section>

                <section className="card span-7" aria-labelledby="h-dp">
                  <div className="card-head">
                    <h2 id="h-dp" className="card-title">
                      {dimTitle}
                    </h2>
                    <div className="card-tools">
                      {hasChiefs && (
                        <div className="tool">
                          <span className="tool-label" aria-hidden="true">
                            แยกตาม
                          </span>
                          <div className="dash-seg sm" role="group" aria-label="แยกตาม">
                            {(
                              [
                                ["chief", "Chief"],
                                ["dept", "หน่วยงาน"],
                              ] as const
                            ).map(([key, label]) => (
                              <button
                                key={key}
                                type="button"
                                aria-pressed={dim === key}
                                onClick={() => {
                                  setDimChoice(key);
                                  setAllDepts(false);
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="tool">
                        <span className="tool-label" aria-hidden="true">
                          เรียงตาม
                        </span>
                        <div className="dash-seg sm" role="group" aria-label="เรียงลำดับ">
                          {(
                            [
                              ["pending", "ค้างมากสุด"],
                              ["pct", "% ต่ำสุด"],
                            ] as const
                          ).map(([key, label]) => (
                            <button key={key} type="button" aria-pressed={deptSort === key} onClick={() => setDeptSort(key)}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  {view === "chart" ? <MeterList groups={shownDepts} variant="dept" emphasize={EMPHASIZED} /> : <GroupTable groups={shownDepts} first={dimWord} />}
                  {depts.length > rowLimit && (
                    <button type="button" className="more-btn" onClick={() => setAllDepts((v) => !v)} aria-expanded={allDepts}>
                      {allDepts ? "แสดงน้อยลง" : `${dimAll} (${depts.length})`}
                    </button>
                  )}
                </section>

                <section className="card span-5" aria-labelledby="h-rc">
                  <h2 id="h-rc" className="card-title">
                    ส่งล่าสุด
                  </h2>
                  <Recent recent={st.recent} now={now} fresh={fresh} />
                </section>

                <section className="card span-12" aria-labelledby="h-fin">
                  <h2 id="h-fin" className="card-title">
                    หน่วยงานที่ส่งครบแล้ว <span className="card-title-note">· ใครเสร็จก่อนอยู่บนสุด</span>
                  </h2>
                  <Finished finished={st.finished} />
                </section>
              </div>
            )}
          </main>

          <nav className="tabbar" aria-label="เมนูหลัก">
            <div className="tabbar-in">
              <Link href="/?tab=home">
                <HomeIcon />
                หน้าหลัก
              </Link>
              <Link href="/?tab=list">
                <ListIcon />
                รายชื่อ
              </Link>
              <Link href="/dashboard" className="on" aria-current="page">
                <ChartIcon />
                ภาพรวม
              </Link>
            </div>
          </nav>
        </div>
      )}

      {announce && (
        <div key={announce.key} className={`announce${tv ? " big" : ""}`} role="status">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
          </svg>
          {announce.text}
        </div>
      )}
      {party > 0 && <Confetti key={party} />}
    </>
  );
}

/** The headline: the one big number, its meter, and the supporting figures beside it. */
function Hero({ st, now, bump, complete }: { st: Stats; now: number; bump: number; complete: boolean }) {
  // counted here, outside the keyed span below: remounting that span replays the bump without restarting the count from 0
  const gotShown = useCountUp(st.got);
  const pctShown = useCountUp(st.pct);
  return (
    <section className="card span-12 hero" aria-labelledby="h-hero">
      <div className="hero-main">
        <h2 id="h-hero" className="card-title">
          ส่งของขวัญแล้ว
        </h2>
        <div className="hero-row">
          <span key={bump} className={`hero-num${bump ? " bump" : ""}`}>
            {gotShown}
          </span>
          <span className="hero-of">จากทั้งหมด {st.total} คน</span>
          <span className="hero-pct">{pctShown}%</span>
        </div>
        <div className="meter-wrap">
          <Meter got={st.got} total={st.total} label="สัดส่วนคนที่ส่งของขวัญแล้ว" tall />
        </div>
        <p className="hero-sub">{st.pending > 0 ? `เหลืออีก ${st.pending} คน` : "ครบทุกคนแล้ว"}</p>
        <p className="hero-cheer">{cheerOf(st.got, st.total)}</p>
      </div>
      <Tiles st={st} now={now} />
    </section>
  );
}

function Tiles({ st, now }: { st: Stats; now: number }) {
  return (
    <ul className="tiles">
      <Tile label="ยังไม่ส่ง" value={<CountUp value={st.pending} />} sub={`จาก ${st.total} คน`} />
      <Tile label="ส่งใน 1 ชั่วโมงล่าสุด" value={<CountUp value={st.lastHour} />} sub="คน" />
      <Tile
        label="ส่งล่าสุด"
        value={st.lastAt !== null ? ago(now, st.lastAt) : "ยังไม่มี"}
        sub={st.lastAt !== null ? `${dayOf(st.lastAt)} ${clock(st.lastAt)}` : "รอการบันทึกแรก"}
        small
      />
      <Tile
        label="หน่วยงานที่ครบแล้ว"
        value={
          <>
            <CountUp value={st.doneDepts} />/{st.depts.length}
          </>
        }
        sub="หน่วยงาน"
      />
    </ul>
  );
}

function Meter({ got, total, label, tall, i = 0 }: { got: number; total: number; label: string; tall?: boolean; i?: number }) {
  const target = total ? (got / total) * 100 : 0;
  const [width, setWidth] = useState(0); // starts empty, so the bar grows in on first paint and on every change
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return (
    <div
      className={`meter${tall ? " tall" : ""}`}
      style={{ "--i": Math.min(i, 10) } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={got}
      aria-label={label}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

function Tile({ label, value, sub, small }: { label: string; value: ReactNode; sub: string; small?: boolean }) {
  return (
    <li className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value${small ? " small" : ""}`}>{value}</span>
      <span className="tile-sub">{sub}</span>
    </li>
  );
}

/** One row per group: its name, a bar against its own whole, the figures, and how many are still to come. */
function MeterList({ groups, variant, emphasize = 0 }: { groups: Group[]; variant: "co" | "dept"; emphasize?: number }) {
  return (
    <ul className={`mlist ${variant}`}>
      {groups.map((g, i) => {
        const left = g.total - g.got;
        const stands = i < emphasize && left > 0; // the ones furthest behind
        return (
          <li key={g.name} className={`mrow${stands ? " emph" : ""}`}>
            <span className="mrow-name">{g.name}</span>
            <Meter got={g.got} total={g.total} label={`${g.name}: ส่งแล้ว ${g.got} จาก ${g.total} คน`} i={i} />
            <span className="mrow-fig">
              <span className="mrow-n">
                <b>{g.got}</b>/{g.total}
              </span>
              <span className="mrow-pct">{pctOf(g.got, g.total)}%</span>
              <span className="mrow-left">{left > 0 ? `ค้าง ${left}` : "ครบ"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function GroupTable({ groups, first }: { groups: Group[]; first: string }) {
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col" className="num">ทั้งหมด</th>
            <th scope="col" className="num">ส่งแล้ว</th>
            <th scope="col" className="num">ยังไม่ส่ง</th>
            <th scope="col" className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.name}>
              <th scope="row">{g.name}</th>
              <td className="num">{g.total}</td>
              <td className="num">{g.got}</td>
              <td className="num">{g.total - g.got}</td>
              <td className="num">{pctOf(g.got, g.total)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimelineTable({ timeline }: { timeline: Stats["timeline"] }) {
  const daily = timeline.slotMs >= DAY;
  const multi = timeline.points.length > 0 && dayOf(timeline.start) !== dayOf(timeline.points[timeline.points.length - 1].at);
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <th scope="col">{daily ? "วันที่" : "ช่วงเวลา"}</th>
            <th scope="col" className="num">ส่งเพิ่ม</th>
            <th scope="col" className="num">รวมสะสม</th>
          </tr>
        </thead>
        <tbody>
          {timeline.points.map((p) => (
            <tr key={p.from}>
              <th scope="row">{daily ? dayOf(p.from) : `${multi ? dayShort(p.from) + " " : ""}${clock(p.from)}–${clock(p.at)}`}</th>
              <td className="num">{p.added}</td>
              <td className="num">{p.cumulative}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The departments that have handed in every gift, in the order they finished; the first three get a medal. */
function Finished({ finished }: { finished: Stats["finished"] }) {
  const [all, setAll] = useState(false);
  if (!finished.length) return <EmptyGift title="ยังไม่มีหน่วยงานไหนส่งครบ" hint="ใครจะเป็นที่หนึ่ง?" />;
  const podium = finished.slice(0, 3);
  const LIST = 6;
  const rest = finished.slice(3);
  const shown = all ? rest : rest.slice(0, LIST);
  const when = (g: Group) => (
    <span className="fin-when">
      <b>{clock(g.doneAt!)}</b>
      <span>{dayShort(g.doneAt!)}</span>
    </span>
  );
  return (
    <div className="fin">
      <ol className="fin-podium">
        {podium.map((g, i) => (
          <li key={g.name} className={`fin-top medal-${i + 1}`}>
            {i === 0 && (
              <svg className="fin-crown" width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">
                <path d="M2 6l6 5 7-9 7 9 6-5-2.5 14h-21z" fill="currentColor" />
                <circle cx="2" cy="6" r="2" fill="currentColor" />
                <circle cx="15" cy="2" r="2" fill="currentColor" />
                <circle cx="28" cy="6" r="2" fill="currentColor" />
              </svg>
            )}
            <span className="fin-medal" aria-label={`อันดับ ${i + 1}`}>
              {i + 1}
            </span>
            <span className="fin-who">
              <span className="fin-name">{g.name}</span>
              <span className="fin-meta">{g.total} คน</span>
            </span>
            {when(g)}
          </li>
        ))}
      </ol>
      {shown.length > 0 && (
        <ol className="fin-list" start={4}>
          {shown.map((g, i) => (
            <li key={g.name} className="fin-item">
              <span className="fin-rank" aria-label={`อันดับ ${i + 4}`}>
                {i + 4}
              </span>
              <span className="fin-who">
                <span className="fin-name">{g.name}</span>
                <span className="fin-meta">{g.total} คน</span>
              </span>
              {when(g)}
            </li>
          ))}
        </ol>
      )}
      {rest.length > LIST && (
        <button type="button" className="more-btn" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "แสดงน้อยลง" : `ดูครบทุกอันดับ (${finished.length})`}
        </button>
      )}
    </div>
  );
}

function Recent({ recent, now, fresh, limit }: { recent: Stats["recent"]; now: number; fresh: number[]; limit?: number }) {
  if (!recent.length) return <EmptyGift title="ยังไม่มีใครบันทึกการส่ง" />;
  return (
    <ul className="recent">
      {recent.slice(0, limit ?? recent.length).map((r) => (
        <li key={`${r.code}-${r.at}`} className={fresh.includes(r.row) ? "fresh" : undefined}>
          <span className="rc-dot" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
            </svg>
          </span>
          <span className="rc-who">
            <span className="rc-name">{r.nickname || r.name}</span>
            <span className="rc-meta">{[r.dept, r.company].filter(Boolean).join(", ")}</span>
          </span>
          <span className="rc-when">
            <b>{clock(r.at)}</b>
            <span>{ago(now, r.at)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- big-screen mode ---------------- */

/**
 * Everything on one screen, no scrolling, for a TV or a projector. It is laid out on a fixed 1600x900 canvas and
 * the canvas is scaled to the screen, so the proportions are the same on any display.
 */
function TvView({ st, now, updated, asOf, fresh, bump, complete, onExit }: { st: Stats; now: number; updated: number; asOf: number; fresh: number[]; bump: number; complete: boolean; onExit: () => void }) {
  const [box, setBox] = useState<{ k: number; x: number; y: number } | null>(null);
  const [idle, setIdle] = useState(false);
  const [clockNow, setClockNow] = useState(asOf);
  const byChief = st.chiefs.length > 0;
  const depts = useMemo(() => sortDepts(byChief ? st.chiefs : st.depts, "pending"), [byChief, st.chiefs, st.depts]);

  useEffect(() => {
    const fit = () => {
      const k = Math.min(window.innerWidth / STAGE.w, window.innerHeight / STAGE.h);
      setBox({ k, x: (window.innerWidth - STAGE.w * k) / 2, y: (window.innerHeight - STAGE.h * k) / 2 });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockNow(wallNow()), 1000);
    return () => clearInterval(id);
  }, []);

  // the pointer and the exit button fade away when nobody is using them
  useEffect(() => {
    let t = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);

  const more = Math.max(0, depts.length - 5);

  return (
    <div className={`tv${idle ? " idle" : ""}`} data-ready={box ? "true" : "false"}>
      <div className="tv-stage" style={box ? { transform: `scale(${box.k})`, left: box.x, top: box.y } : undefined}>
        <header className="tv-head">
          <div>
            <h1>ภาพรวมการส่งของขวัญ</h1>
            <p className="dash-sub">อัปเดตล่าสุด {stamp(updated)}</p>
          </div>
          <div className="tv-clock">{stamp(clockNow)}</div>
        </header>

        {st.total === 0 ? (
          <p className="empty">ยังไม่มีรายชื่อในชีต</p>
        ) : (
          <div className="tv-grid">
            <div className="tv-hero">
              <Hero st={st} now={now} bump={bump} complete={complete} />
            </div>

            <section className="card tv-co" aria-labelledby="tv-h-co">
              <h2 id="tv-h-co" className="card-title">
                แยกตามบริษัท
              </h2>
              <MeterList groups={st.companies.slice(0, 5)} variant="co" />
            </section>

            <section className="card tv-tl" aria-labelledby="tv-h-tl">
              <h2 id="tv-h-tl" className="card-title">
                จำนวนคนที่ส่งแล้ว (สะสม) ตามเวลา
              </h2>
              {st.timeline.points.length === 0 ? <EmptyGift title="ยังไม่มีใครบันทึกการส่ง" /> : <TimelineChart timeline={st.timeline} total={st.total} height={190} />}
            </section>

            <section className="card tv-dp" aria-labelledby="tv-h-dp">
              <h2 id="tv-h-dp" className="card-title">
                {byChief ? "Chief ที่ยังค้างมากสุด" : "หน่วยงานที่ยังค้างมากสุด"}
                {more > 0 ? <span className="card-title-note"> · อีก {more} {byChief ? "Chief" : "หน่วยงาน"} ไม่แสดง</span> : null}
              </h2>
              <MeterList groups={depts.slice(0, 5)} variant="dept" emphasize={EMPHASIZED} />
            </section>

            <section className="card tv-rc" aria-labelledby="tv-h-rc">
              <h2 id="tv-h-rc" className="card-title">
                ส่งล่าสุด
              </h2>
              <Recent recent={st.recent} now={now} fresh={fresh} limit={4} />
            </section>
          </div>
        )}
      </div>

      <button type="button" className="tv-exit" onClick={onExit} aria-label="ออกจากโหมดจอใหญ่">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
        ออก
      </button>
    </div>
  );
}
