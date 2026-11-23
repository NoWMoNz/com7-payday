import { getAdmin } from "@/lib/auth";
import { lockRow, RowChangedError, saveRow } from "@/lib/people";

/** Undo a mistaken check. The photo stays in Blob storage. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return Response.json({ error: "หมดเวลาเข้าสู่ระบบ ให้เข้าสู่ระบบแอดมินอีกครั้ง" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { row?: number; code?: string };
  const row = Number(body.row);
  try {
    const { cols, headerUpdates } = await lockRow(row, String(body.code ?? ""));
    const person = await saveRow(
      row,
      [
        ...headerUpdates,
        { row, col: cols.status, value: false },
        { row, col: cols.timestamp, value: "" },
        { row, col: cols.photo, value: "" },
        { row, col: cols.checkedBy, value: "" },
      ],
      true
    );
    return Response.json({ person });
  } catch (e) {
    const status = e instanceof RowChangedError ? 409 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
