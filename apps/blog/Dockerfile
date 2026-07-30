# Astro SSR server for blog.chapellu.fr.
#
# Runtime deps only in the final stage: astro itself is a build-time tool, but
# the MDX pipeline (@mdx-js/mdx, preact, gray-matter) runs on every request
# because articles arrive in the pod after this image was built.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    CONTENT_DIR=/content/current/content
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
