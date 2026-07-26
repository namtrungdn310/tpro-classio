FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS builder

WORKDIR /app

ARG NEXT_INTERNAL_API_URL=http://backend:8000
ENV NEXT_INTERNAL_API_URL=$NEXT_INTERNAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ARG NEXT_INTERNAL_API_URL=http://backend:8000
ENV NEXT_INTERNAL_API_URL=$NEXT_INTERNAL_API_URL

COPY --chown=65532:65532 --from=builder /app/public ./public
COPY --chown=65532:65532 --from=builder /app/.next/standalone ./
COPY --chown=65532:65532 --from=builder /app/.next/static ./.next/static

USER 65532:65532

EXPOSE 3000

CMD ["server.js"]
