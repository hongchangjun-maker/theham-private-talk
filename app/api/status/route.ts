export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      service: "THEHAM PRIVATE TALK",
      ok: false,
      backend: "cloudflare",
      integrations: {
        cloudflare: false,
        auth: false,
        chat: false,
        video: Boolean(process.env.REALTIMEKIT_ORG_ID && process.env.REALTIMEKIT_API_KEY),
        storage: false,
        webPush: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      },
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
