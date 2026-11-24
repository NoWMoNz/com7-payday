"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Person } from "@/lib/people";
import { cheerOf, chiefGroups, companyOf, hasChiefLevel, pctOf, tally, toneOf } from "@/lib/stats";
import { useCountUp } from "./use-count-up";

const today = () => new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

/** A progress ring: brand red, turning gold once complete. The number is always in ink. */
export function Ring({ pct, size = 50 }: { pct: number; size?: number }) {
  const C = 138.2; // 2 * pi * r
  return (
    <svg className={`ring ${toneOf(pct)}${pct >= 100 ? " full" : ""}`} width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="22" className="ring-bg" />
      {pct > 0 && <circle cx="28" cy="28" r="22" className="ring-fg" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 28 28)" />}
      <text x="28" y="33" textAnchor="middle">
        {pct}
      </text>
    </svg>
  );
}

/** The first tab: how far along everyone is, then each company, which opens a drill-down by Chief and department. */
export default function HomeTab({ people, shine, onCompany }: { people: Person[]; shine: number; onCompany: (company: string) => void }) {
  const total = people.length;
  const got = people.filter((p) => p.received).length;
  const pct = pctOf(got, total);
  const complete = total > 0 && got === total;
  const groups = useMemo(() => tally(people, companyOf).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "th")), [people]);

  const pctShown = useCountUp(pct);
  const [barWidth, setBarWidth] = useState(0); // starts empty so the bar grows in
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarWidth(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <main className="home">
      <div className="wrap">
        <h2 className="home-hello">ติดตามของขวัญ</h2>

        {total === 0 ? (
          <p className="empty">ยังไม่มีรายชื่อในชีต</p>
        ) : (
          <>
            <section className="hero-card" aria-label="ความคืบหน้ารวม">
              <div className="hc-top">
                <span className="hc-av" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
                  </svg>
                </span>
                <div className="hc-t">
                  <b>ความคืบหน้าของขวัญ</b>
                  <small>
                    พนักงาน {total} คน · {groups.length} บริษัท
                  </small>
                </div>
                <div className="hc-pct">
                  <span key={shine} className={shine ? "bump" : undefined}>
                    {pctShown}
                  </span>
                  <em>%</em>
                </div>
              </div>
              <div className="hc-barwrap">
                <div className="hc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="สัดส่วนคนที่ส่งของขวัญแล้ว">
                  <i style={{ width: `${barWidth}%` }}>{shine > 0 && <span key={shine} className="ribbon-shine" />}</i>
                </div>
              </div>
              <div className="hc-foot">
                <span suppressHydrationWarning>{today()}</span>
                <span>
                  ส่งแล้ว {got}/{total}
                </span>
              </div>
              <p className="hc-cheer">{cheerOf(got, total)}</p>
            </section>

            <div className="title">
              <h3>บริษัททั้งหมด</h3>
              <Link href="/dashboard" className="pill">
                ดูภาพรวมละเอียด
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
            <ul className="co-list">
              {groups.map((g) => {
                const areas = hasChiefLevel(people, g.name) ? chiefGroups(people, g.name).length : 0;
                return (
                  <li key={g.name}>
                    <button type="button" className="co-row" onClick={() => onCompany(g.name)}>
                      <Ring pct={pctOf(g.got, g.total)} />
                      <span className="t">
                        <b>{g.name}</b>
                        <small>
                          {g.got}/{g.total} คน{areas ? ` · ${areas} Chief` : ""}
                        </small>
                      </span>
                      <span className="chev" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
