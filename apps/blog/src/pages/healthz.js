// Liveness/readiness endpoint. Deliberately does not touch the content volume:
// the app is healthy even when git-sync has not landed anything yet.
export function GET() {
  return new Response('ok\n', { headers: { 'Content-Type': 'text/plain' } });
}
