# Astro SSR server for blog.chapellu.fr.
#
# The runtime stage reuses the build stage's node_modules verbatim rather than
# reinstalling production deps. Astro's server bundle imports from `astro`
# itself at runtime (piccolore, devalue, …), so an `--omit=dev` tree crashes on
# startup with ERR_MODULE_NOT_FOUND — and copying the exact tree that was built
# and tested removes a whole class of "works locally" surprises.
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
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
