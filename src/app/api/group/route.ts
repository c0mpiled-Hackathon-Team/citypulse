import { z } from "zod";
import { groupCases } from "@/lib/group";

// POST /api/group  { cases: Case[], minSize?: number } → { incidents: Incident[] }
const CaseSchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  category: z.string().min(1),
  office: z.string(),
  typicalDaysToClose: z.number().nullable(),
  locationText: z.string().nullable(),
  district: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  createdAt: z.string(),
});

const BodySchema = z.object({
  cases: z.array(CaseSchema).max(2000),
  minSize: z.number().int().min(1).optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { \"cases\": Case[] }" }, { status: 400 });
  }
  const body = BodySchema.safeParse(json);
  if (!body.success) {
    const issue = body.error.issues[0];
    return Response.json({ error: `${issue?.path.join(".")}: ${issue?.message}` }, { status: 400 });
  }
  return Response.json({ incidents: groupCases(body.data.cases, { minSize: body.data.minSize }) });
}
