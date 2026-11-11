import { z } from "zod";
import { groupCases } from "@/lib/group";

// POST /api/group  { cases: Case[], minSize?: number } → { incidents: Incident[] }
// Errors: 400 { error: string }
const CaseSchema = z.object({
  id: z.string().min(1).max(100),
  summary: z.string().max(500),
  category: z.string().min(1).max(100),
  office: z.string().max(200),
  typicalDaysToClose: z.number().nullable(),
  locationText: z.string().max(200).nullable(),
  district: z.string().max(50).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

const BodySchema = z.object({
  cases: z
    .array(CaseSchema)
    .max(2000)
    .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, "Case ids must be unique"),
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
