import { Suspense } from "react";
import BoardLoader from "./board-loader";

/**
 * A static shell: it reads nothing on the server, so it is prefetched and opens instantly.
 * The list itself comes from /api/people (or from memory when coming back from the overview).
 */
export default function Page() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <BoardLoader skeleton={<BoardSkeleton />} />
    </Suspense>
  );
}

function BoardSkeleton() {
  return (
    <>
      <header className="appbar">
        <div className="wrap">
          <div className="bar">
            <span className="logo" aria-hidden="true" />
            <div className="bar-t">
              <h1>เช็คของขวัญ</h1>
              <p className="who">กำลังโหลดรายชื่อ...</p>
            </div>
          </div>
        </div>
      </header>
      <main className="home" aria-busy="true">
        <div className="wrap">
          <div className="skeleton" style={{ height: 150, borderRadius: 22 }} />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 74, borderRadius: 20 }} />
          ))}
        </div>
      </main>
    </>
  );
}
