"use client";

import type { ReactNode } from "react";
import { useBoot } from "@/lib/people-cache";
import GiftBoard from "./gift-board";

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The list page's data: from memory when we have it (instant), otherwise fetched once behind the skeleton. */
export default function BoardLoader({ skeleton }: { skeleton: ReactNode }) {
  const { boot, error, stale } = useBoot();
  if (error) {
    return (
      <div className="error-box" role="alert">
        <h2>โหลดรายชื่อจาก Google Sheet ไม่สำเร็จ</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!boot) return skeleton;
  return <GiftBoard initialPeople={boot.people} initialAdminName={boot.adminName} loadedAt={clock(boot.at)} stale={stale} />;
}
