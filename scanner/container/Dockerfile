# The scanner image: Node and the bundled server only. Runs as an unprivileged user with no
# network (the Worker turns internet off) and never runs skill code.
# Pinned by digest (node 22 alpine, 2026-09-23).
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
COPY dist/server.mjs ./server.mjs
ENV NODE_ENV=production SCANNER_LISTEN=1
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
