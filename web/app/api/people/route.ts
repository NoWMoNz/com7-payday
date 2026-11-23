import { getAdmin } from "@/lib/auth";
import { listPeople } from "@/lib/people";

export async function GET() {
  const admin = await getAdmin();
  try {
    const people = await listPeople(!!admin);
    return Response.json(
      { people, adminName: admin?.name ?? null },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
