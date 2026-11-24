import { checkLogin, startSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const admin = await checkLogin(String(body.username ?? ""), String(body.password ?? ""));
  if (!admin) {
    await new Promise((r) => setTimeout(r, 600)); // slow down password guessing
    return Response.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }
  await startSession(admin);
  return Response.json({ name: admin.name });
}
