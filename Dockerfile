# Produksia: image produksi multi-tahap (Next.js standalone). Migrasi basis data dijalankan oleh layanan
# `migrasi` di docker-compose.yml (memakai tahap `build` yang masih punya Prisma CLI), bukan oleh image runtime.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# URL tiruan: generate & build tidak menyentuh basis data (semua halaman dinamis), hanya butuh variabelnya ada
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --config prisma7.config.ts && npx next build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S produksia && adduser -S produksia -G produksia
COPY --from=build --chown=produksia:produksia /app/.next/standalone ./
COPY --from=build --chown=produksia:produksia /app/.next/static ./.next/static
COPY --from=build --chown=produksia:produksia /app/public ./public
USER produksia
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/sehat || exit 1
CMD ["node", "server.js"]
