import { Suspense } from "react";
import { connection } from "next/server";
import { getAdmin } from "@/lib/auth";
import { listPeople, type Person } from "@/lib/people";
import GiftBoard from "./gift-board";

export default function Page() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Board />
    </Suspense>
  );
}

async function Board() {
  await connection(); // always read the sheet per request
  const admin = await getAdmin();
  let result: { people: Person[] } | { error: string };
  try {
    result = { people: await listPeople(!!admin) };
  } catch (e) {
    result = { error: (e as Error).message };
  }
  if ("error" in result) {
    return (
      <div className="error-box" role="alert">
        <h2>โหลดรายชื่อจาก Google Sheet ไม่สำเร็จ</h2>
        <p>{result.error}</p>
      </div>
    );
  }
  return (
    <GiftBoard
      initialPeople={result.people}
      initialAdminName={admin?.name ?? null}
      loadedAt={clock()}
    />
  );
}

function clock(d = new Date()) {
  return d.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function BoardSkeleton() {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div>
              <h1>เช็คของขวัญ</h1>
              <p className="who">กำลังโหลดรายชื่อ...</p>
            </div>
          </div>
          <div className="tally">
            <div className="tally-line">
              <span className="tally-done">–</span>
            </div>
            <div className="ribbon" />
          </div>
        </div>
      </header>
      <main>
        <ul className="list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="skeleton" />
          ))}
        </ul>
      </main>
    </>
  );
}
