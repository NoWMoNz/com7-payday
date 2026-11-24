"use client";

import type { ReactNode } from "react";
import { useBoot } from "@/lib/people-cache";
import { wallNow } from "@/lib/stats";
import Dashboard from "./dashboard";

/** The overview's data: from memory when we have it (instant), otherwise fetched once behind the skeleton. */
export default function DashboardLoader({ skeleton }: { skeleton: ReactNode }) {
  const { boot, error, stale } = useBoot();
  if (error) {
    return (
      <div className="error-box" role="alert">
        <h2>โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!boot) return skeleton;
  return <Dashboard initialPeople={boot.people} asOf={wallNow(boot.at)} stale={stale} />;
}
