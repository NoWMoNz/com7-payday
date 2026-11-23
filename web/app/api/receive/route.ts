import { getAdmin } from "@/lib/auth";
import { lockRow, RowChangedError, saveRow, thaiTimestamp } from "@/lib/people";
import { savePhoto } from "@/lib/photos";

const MAX_BYTES = 15 * 1024 * 1024;

/** Admin confirms a gift: upload the photo, then Status = TRUE + Timestamp in the sheet. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return Response.json({ error: "หมดเวลาเข้าสู่ระบบ ให้เข้าสู่ระบบแอดมินอีกครั้ง" }, { status: 401 });

  const form = await req.formData();
  const row = Number(form.get("row"));
  const code = String(form.get("code") ?? "");
  const photo = form.get("photo");
  if (!(photo instanceof File) || !photo.type.startsWith("image/") || photo.size === 0) {
    return Response.json({ error: "ไม่พบรูปภาพ ให้ถ่ายรูปของขวัญก่อนบันทึก" }, { status: 400 });
  }
  if (photo.size > MAX_BYTES) {
    return Response.json({ error: "รูปใหญ่เกิน 15MB ให้ถ่ายใหม่" }, { status: 400 });
  }

  try {
    const { cols, headerUpdates } = await lockRow(row, code);
    const pathname = await savePhoto(code, photo);
    const photoUrl = `${new URL(req.url).origin}/api/photo?p=${encodeURIComponent(pathname)}`;
    const person = await saveRow(
      row,
      [
        ...headerUpdates,
        { row, col: cols.status, value: true },
        { row, col: cols.timestamp, value: thaiTimestamp() },
        { row, col: cols.photo, value: photoUrl },
        { row, col: cols.checkedBy, value: admin.name },
      ],
      true
    );
    return Response.json({ person });
  } catch (e) {
    const status = e instanceof RowChangedError ? 409 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
