import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function safeName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = Date.now();
  return `${stamp}-${base}`;
}

export async function POST(req: Request) {
  const data = await req.formData();
  const file = data.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });

  const name = safeName(file.name);
  const buf = Buffer.from(await file.arrayBuffer());
  const filePath = path.join(uploadDir, name);
  await writeFile(filePath, buf);

  return NextResponse.json({ url: `/uploads/${name}`, name });
}
