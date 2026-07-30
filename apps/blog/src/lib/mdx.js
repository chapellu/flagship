// Compiles an article's MDX to HTML at request time.
//
// Astro's own content collections compile MDX during `astro build`, which
// cannot work here: articles arrive in the pod after the image was built. So
// MDX is evaluated per article with @mdx-js/mdx and rendered to a string with
// preact, against a fixed component registry — an article can only use
// components this app already ships, which is the property we want anyway.

import { evaluate } from '@mdx-js/mdx';
import * as runtime from 'preact/jsx-runtime';
import { render } from 'preact-render-to-string';
import { h } from 'preact';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';

const cache = new Map(); // slug -> { key, html }

// ```mermaid fences become <pre class="mermaid">, which the client script
// upgrades into a rendered diagram. Everything else stays a normal code block.
function Pre(props) {
  const child = Array.isArray(props.children) ? props.children[0] : props.children;
  const className = child?.props?.className || '';
  if (className.includes('language-mermaid')) {
    const code = child.props.children;
    return h('pre', { class: 'mermaid' }, typeof code === 'string' ? code : String(code ?? ''));
  }
  return h('pre', { class: 'code-block' }, child);
}

// Available to any article: <Callout>…</Callout> and <Pullquote>…</Pullquote>.
function Callout({ label = 'Note', children }) {
  return h('aside', { class: 'callout' }, [
    h('div', { class: 'callout-label', key: 'l' }, label),
    h('div', { class: 'callout-body', key: 'b' }, children),
  ]);
}

function Pullquote({ children }) {
  return h('blockquote', { class: 'pullquote' }, children);
}

const components = { pre: Pre, Callout, Pullquote };

export async function renderArticle(article) {
  const key = `${article.slug}:${article.body.length}:${article.title}`;
  const hit = cache.get(article.slug);
  if (hit && hit.key === key) return hit.html;

  const mod = await evaluate(article.body, {
    ...runtime,
    development: false,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  });

  const html = render(h(mod.default, { components }));
  cache.set(article.slug, { key, html });
  return html;
}

/** True when the article needs the (heavy) mermaid bundle on the client. */
export function usesMermaid(article) {
  return /```mermaid/.test(article.body);
}
