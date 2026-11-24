"use client";

import type { CSSProperties } from "react";
import type { Person } from "@/lib/people";
import { chiefGroups, chiefOf, companyOf, deptGroups, hasChiefLevel, pctOf, toneOf, type Scope } from "@/lib/stats";

export type Drill = { company: string; chief: string }; // chief "" = still at the company level

const tone = (pct: number) => ({ "--c": `var(--st-${toneOf(pct)})` }) as CSSProperties;

/** "27/27" with a "ครบ" chip once everyone has handed in, otherwise how many are still to come. */
function Figure({ got, total }: { got: number; total: number }) {
  const left = total - got;
  return (
    <span className="srow-fig">
      <span className="srow-n">
        <b>{got}</b>/{total}
      </span>
      <span className={left > 0 ? "chip-left" : "chip-done"}>{left > 0 ? `ค้าง ${left}` : "ครบ"}</span>
    </span>
  );
}

function Chevron() {
  return (
    <svg className="srow-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Inside the bottom sheet that a company row opens: its Chief areas, then the departments of one area (or of the
 * whole company when it has no areas). Picking a department hands the choice back so the list can show those people.
 */
export default function DrillSheet({
  people,
  drill,
  onChief,
  onBack,
  onList,
  onClose,
}: {
  people: Person[];
  drill: Drill;
  onChief: (chief: string) => void;
  onBack: () => void;
  onList: (scope: Scope) => void;
  onClose: () => void;
}) {
  const { company } = drill;
  const areas = hasChiefLevel(people, company); // Com7 has Chief areas; a company whose Chief is just its own name does not
  const chief = areas ? drill.chief : "";
  const inside = people.filter((p) => companyOf(p) === company && (!chief || chiefOf(p) === chief));
  const got = inside.filter((p) => p.received).length;
  const pct = pctOf(got, inside.length);
  const left = inside.length - got;
  const atAreas = areas && !chief;

  const title = atAreas ? `${company} · Chief` : `${company}${chief ? ` · ${chief}` : ""} · แผนก`;

  return (
    <div className="sheet-body">
      <div className="grab" data-drag />
      {chief && (
        <button type="button" className="mini" onClick={onBack}>
          ‹ กลับไปเลือก Chief
        </button>
      )}
      <div className="sheet-head" data-drag>
        <div>
          <h2 id="drillTitle">{title}</h2>
          <p className="drill-sub">{left === 0 ? `ครบทุกคนแล้ว · ${inside.length} คน` : `ส่งแล้ว ${got}/${inside.length} (${pct}%) · เหลือ ${left}`}</p>
        </div>
        <button className="close" type="button" aria-label="ปิด" onClick={onClose}>
          ✕
        </button>
      </div>

      {atAreas ? (
        <div className="sec rows">
          {chiefGroups(people, company).map((g) => {
            const p = pctOf(g.got, g.total);
            return (
              <button key={g.name} type="button" className="srow" style={tone(p)} onClick={() => onChief(g.name)}>
                <span className="top">
                  <span className="srow-name">{g.name}</span>
                  <Figure got={g.got} total={g.total} />
                  <Chevron />
                </span>
                <span className="pb">
                  <i style={{ width: `${p}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="sec">
          <div className="top2">
            <span>ความคืบหน้า</span>
            <b>{pct}%</b>
          </div>
          <div className="pb big" style={tone(pct)}>
            <i className={left === 0 ? "full" : undefined} style={{ width: `${pct}%` }} />
          </div>
          <div className="dl">
            {deptGroups(people, company, chief).map((g) => {
              const p = pctOf(g.got, g.total);
              return (
                <button key={g.name} type="button" className="drow" onClick={() => onList({ company, chief, dept: g.name })}>
                  <span className="srow-name">{g.name}</span>
                  <Figure got={g.got} total={g.total} />
                  <Chevron />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn btn-quiet" type="button" onClick={onClose}>
          ปิด
        </button>
        <button className="btn btn-primary" type="button" onClick={() => onList({ company, chief, dept: "" })}>
          ดูรายชื่อ{chief ? ` ${chief}` : ` ${company}`}
        </button>
      </div>
    </div>
  );
}
