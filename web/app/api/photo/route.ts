import { getAdmin } from "@/lib/auth";
import { readPhoto } from "@/lib/photos";

export async function GET(req: Request) {
  if (!(await getAdmin())) {
    return new Response("เข้าสู่ระบบแอดมินก่อนเพื่อดูรูป", { status: 401 });
  }
  const p = new URL(req.url).searchParams.get("p") ?? "";
  const photo = await readPhoto(p);
  if (!photo) return new Response("ไม่พบรูป", { status: 404 });
  return new Response(photo.body, {
    headers: {
      "content-type": photo.type,
      // pathnames are unique per upload, so the browser can keep them
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
