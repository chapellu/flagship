# blog.chapellu.fr — Astro app shell

The application that renders the blog. **It contains no articles.** Those live
in [`chapellu/blog-content`](https://github.com/chapellu/blog-content) and reach
the pod through a `git-sync` sidecar (see `k8s/blog/`).

## Why server-side rendering, and why not content collections

Astro's content collections are compiled during `astro build`. That is
incompatible with the point of this setup: merging a pull request on
`blog-content` must publish an article without rebuilding an image. So:

- every route is SSR (`output: 'server'`, Node adapter, standalone);
- `src/lib/content.js` reads `$CONTENT_DIR` at request time, parses frontmatter,
  and caches each file against its mtime;
- `src/lib/mdx.js` compiles the MDX per article with `@mdx-js/mdx` and renders
  it to a string with preact, against a fixed component registry.

An article can therefore only use components this app ships (`<Callout>`,
`<Pullquote>`, fenced ```mermaid diagrams). That is a feature: content cannot
introduce arbitrary code into the server.

## Local development

```bash
npm install
CONTENT_DIR=../../../blog-content/content npm run dev
```

Point `CONTENT_DIR` at any directory of `.mdx` files — a clone of
`blog-content`, or a branch of it you are reviewing. Without it, the app
defaults to `/content/current/content`, which is where git-sync mounts the repo
in the cluster, and an empty or missing directory renders an empty index rather
than an error.

## Build and deployment

`.github/workflows/blog-image.yml` builds `linux/arm64` (the cluster is a single
Ampere A1 node) on push to `main`, publishes to `ghcr.io/chapellu/blog`, then
commits the new SHA tag into `k8s/blog/deployment.yaml`. Flux does the rollout —
nothing is applied by hand.

> **One-time setup:** after the first successful build, make the GHCR package
> public (package settings → change visibility). k3s then pulls it without an
> imagePullSecret, which is the reason the content repo is public too.
