import { Suspense } from "react";
import { connection } from "next/server";
import { listPeople, type Person } from "@/lib/people";
import { wallNow } from "@/lib/stats";
import Dashboard from "./dashboard";

export const metadata = { title: "ภาพรวม · เช็คของขวัญ" };

export default function Page() {
  return (
    <Suspense fallback={<DashSkeleton />}>
      <Data />
    </Suspense>
  );
}

async function Data() {
  await connection(); // always read the sheet per request
  let result: { people: Person[] } | { error: string };
  try {
    // the same public view as the list page: totals and times only, never photos or who recorded them
    result = { people: await listPeople(false) };
  } catch (e) {
    result = { error: (e as Error).message };
  }
  if ("error" in result) {
    return (
      <div className="error-box" role="alert">
        <h2>โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ</h2>
        <p>{result.error}</p>
      </div>
    );
  }
  return <Dashboard initialPeople={result.people} asOf={wallNow()} />;
}

function DashSkeleton() {
  return (
    <div className="dash">
      <header className="appbar">
        <div className="dash-wrap">
          <div className="bar">
            <span className="logo" aria-hidden="true" />
            <div className="bar-t">
              <h1>เช็คของขวัญ</h1>
              <p className="who">กำลังโหลด...</p>
            </div>
          </div>
        </div>
      </header>
      <main className="dash-main" aria-busy="true">
        <div className="dash-grid">
          <div className="skeleton span-12" style={{ height: 190 }} />
          <div className="skeleton span-5" style={{ height: 260 }} />
          <div className="skeleton span-7" style={{ height: 260 }} />
        </div>
      </main>
    </div>
  );
}
