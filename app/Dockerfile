FROM oven/bun:1.3.6

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown bun:bun /data
USER bun

EXPOSE 3000
CMD ["bun", "server/index.ts"]
