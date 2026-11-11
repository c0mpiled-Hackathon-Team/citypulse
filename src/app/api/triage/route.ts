import { z } from "zod";
import { MAX_TEXT_LENGTH, triage } from "@/lib/ai";

// POST /api/triage  { text } → { cases: Case[], mode: "live" | "mock" | "fallback" }
const BodySchema = z.object({
  text: z.string().trim().min(3, "Please describe the problem.").max(MAX_TEXT_LENGTH),
});

export const maxDuration = 30; // seconds (Vercel); the LLM call itself times out at 20 s

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { \"text\": \"...\" }" }, { status: 400 });
  }
  const body = BodySchema.safeParse(json);
  if (!body.success) {
    return Response.json({ error: body.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  return Response.json(await triage(body.data.text));
}
