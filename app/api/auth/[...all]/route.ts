import { NextResponse } from "next/server";
import { auth, hasAuthConfiguration } from "@/lib/auth";

const handler = auth.handler();

export async function GET(request: Request) {
  if (!hasAuthConfiguration()) {
    return NextResponse.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  return handler.GET(request);
}

export async function POST(request: Request) {
  if (!hasAuthConfiguration()) {
    return NextResponse.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  return handler.POST(request);
}
