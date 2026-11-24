import { Suspense } from "react";
import DashboardLoader from "./dashboard-loader";

export const metadata = { title: "ภาพรวม · เช็คของขวัญ" };

/** A static shell like the list page: opens instantly, the data comes from /api/people or from memory. */
export default function Page() {
  return (
    <Suspense fallback={<DashSkeleton />}>
      <DashboardLoader skeleton={<DashSkeleton />} />
    </Suspense>
  );
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
