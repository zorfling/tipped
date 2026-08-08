// Netlify Scheduled Function (every 10 min, see netlify.toml): pokes the
// tipper endpoint. All logic lives in the Next.js route so it can be tested.
export default async function handler(): Promise<Response> {
  const res = await fetch(`${process.env.APP_URL}/api/cron/tipper`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const body = await res.text();
  console.log(`tipper-cron: ${res.status} ${body}`);
  return new Response(body, { status: res.status });
}
