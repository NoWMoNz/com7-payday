import { useEffect, useState } from "react";
import type { Person } from "./people";

/**
 * The last list the browser received, kept in memory so moving between the list page and the
 * overview paints at once from what is already here, then refreshes in the background.
 *
 * Browser only: this module-level variable would be shared between visitors on a server, so
 * `recall()` returns nothing there and nothing is ever stored there. Never import it from a
 * server component. Lost on a full reload, which is fine: that load fetches it again.
 */
export type Boot = { people: Person[]; adminName: string | null; at: number };

let last: Boot | null = null;

export const recall = (): Boot | null => (typeof window === "undefined" ? null : last);

export function remember(people: Person[], adminName: string | null) {
  if (typeof window !== "undefined") last = { people, adminName, at: Date.now() };
}

/**
 * What a page starts from: the remembered copy if there is one (`stale`: refresh it right away),
 * otherwise a first fetch of /api/people.
 */
export function useBoot(): { boot: Boot | null; error: string; stale: boolean } {
  const [seed] = useState(recall);
  const [boot, setBoot] = useState<Boot | null>(seed);
  const [error, setError] = useState("");

  useEffect(() => {
    if (seed) return;
    let alive = true;
    fetch("/api/people", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { people?: Person[]; adminName?: string | null; error?: string };
        if (!res.ok || !data.people) throw new Error(data.error || `โหลดรายชื่อไม่สำเร็จ (${res.status})`);
        return { people: data.people, adminName: data.adminName ?? null };
      })
      .then(({ people, adminName }) => {
        remember(people, adminName);
        if (alive) setBoot({ people, adminName, at: Date.now() });
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seed]);

  return { boot, error, stale: !!seed };
}
