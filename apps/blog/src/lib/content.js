// Reads articles from the content directory at request time.
//
// The directory is filled by the git-sync sidecar, which pulls
// chapellu/blog-content into a shared emptyDir every ~60s. Nothing here can
// run at build time: the files do not exist in the image, and merging a PR
// must publish without a rebuild. Results are cached per file and invalidated
// on mtime, so a steady-state request re-reads nothing.

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const CONTENT_DIR = process.env.CONTENT_DIR || '/content/current/content';

export const PILLARS = {
  'architecture-platform-engineering': { label: 'Architecture & Platform Eng.', accent: 'var(--gold)' },
  'cloud-iac': { label: 'Cloud & IaC', accent: 'var(--ocean)' },
  'applied-ai': { label: 'Applied AI', accent: 'var(--hermes)' },
  career: { label: 'Career', accent: 'var(--coral)' },
};

const cache = new Map(); // slug -> { mtimeMs, article }

function readingTime(body) {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function parse(slug, raw) {
  const { data, content } = matter(raw);
  return {
    slug,
    title: data.title || slug,
    description: data.description || '',
    pillar: data.pillar && PILLARS[data.pillar] ? data.pillar : null,
    publishDate: toDate(data.publishDate),
    series: data.series || null,
    seriesOrder: typeof data.seriesOrder === 'number' ? data.seriesOrder : null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    draft: data.draft === true,
    readingTime: readingTime(content),
    body: content,
  };
}

async function load(file) {
  const slug = file.replace(/\.mdx?$/, '');
  const full = path.join(CONTENT_DIR, file);
  const stat = await fs.stat(full);
  const hit = cache.get(slug);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.article;

  const article = parse(slug, await fs.readFile(full, 'utf8'));
  cache.set(slug, { mtimeMs: stat.mtimeMs, article });
  return article;
}

/** Every publishable article, newest first. Missing content dir is not fatal. */
export async function listArticles() {
  let files;
  try {
    files = await fs.readdir(CONTENT_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  // git-sync swaps the `current` symlink to a new worktree and garbage-collects
  // the old one, so a file listed a moment ago can vanish mid-read. One
  // unreadable article must not take the index down.
  const articles = await Promise.all(
    files.filter((f) => /\.mdx?$/.test(f)).map((f) =>
      load(f).catch((err) => {
        console.error(`[blog] skipping ${f}:`, err.message);
        return null;
      }),
    ),
  );

  return articles
    .filter((a) => a && !a.draft)
    .sort((a, b) => (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0));
}

export async function getArticle(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null; // no traversal, no surprises
  for (const ext of ['.mdx', '.md']) {
    try {
      return await load(slug + ext);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return null;
}

export function formatDate(date) {
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
