// Native feed — the notification mechanism for a blog with no fixed cadence.
// Built from the same runtime listing as the index, so a merged article shows
// up here on the next git-sync poll like everywhere else.
import { listArticles } from '../lib/content.js';

const SITE = 'https://blog.chapellu.fr';

const escape = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function GET() {
  const articles = await listArticles();

  const items = articles.map((a) => `    <item>
      <title>${escape(a.title)}</title>
      <link>${SITE}/${a.slug}</link>
      <guid isPermaLink="true">${SITE}/${a.slug}</guid>
      <description>${escape(a.description)}</description>
      ${a.publishDate ? `<pubDate>${a.publishDate.toUTCString()}</pubDate>` : ''}
      ${a.pillar ? `<category>${escape(a.pillar)}</category>` : ''}
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>chapellu</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Platform engineering and career notes from a production environment in miniature.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
