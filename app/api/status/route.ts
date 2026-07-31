export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      service: "THEHAM PRIVATE TALK",
      ok: true,
      integrations: {
        supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        video: Boolean(process.env.REALTIMEKIT_ORG_ID && process.env.REALTIMEKIT_API_KEY),
        storage: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.R2_ACCESS_KEY_ID),
        webPush: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      },
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
