import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = body?.url;
  if (!url) {
    return NextResponse.json({ error: "No url provided" }, { status: 400 });
  }

  const name = path.basename(url);
  const filePath = path.join(process.cwd(), "public", "uploads", name);
  await unlink(filePath).catch(() => null);

  return NextResponse.json({ ok: true });
}
