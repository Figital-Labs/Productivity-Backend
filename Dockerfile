# Single-process image: the web server runs the pg-boss meeting worker IN-PROCESS
# (RUN_WORKER_IN_PROCESS defaults true), so one container serves HTTP and consumes the queue.
# To split the worker out later, run this same image with `node dist/worker.js` and set
# RUN_WORKER_IN_PROCESS=false on the web container — no rebuild.

# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Copy the manifest + Prisma schema/config BEFORE `npm ci`, because the `postinstall:
# prisma generate` hook needs a schema to read — otherwise install fails.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Placeholder so `prisma generate` can resolve env("DATABASE_URL"); generate never connects.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# node_modules from build includes the prisma CLI (for `migrate deploy`) + the generated client.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Run unprivileged.
USER node

# The app binds to $PORT (project env uses 8000; code default is 3000). EXPOSE is documentation;
# publish the real port at `docker run -p`.
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000;require('http').get('http://127.0.0.1:'+p+'/livez',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Apply pending migrations, then boot. (Single instance: safe to migrate on start. For >1
# replica, run `prisma migrate deploy` as a one-off release task instead — see DEPLOY.md.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
