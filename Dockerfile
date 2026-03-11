FROM node:22-alpine

WORKDIR /opt/overlord-mcp

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

ENV TRANSPORT=stdio
ENV PORT=3002
ENV PROXMOX_HOST=""
ENV PROXMOX_TOKEN_ID=""
ENV PROXMOX_TOKEN_SECRET=""
ENV PROXMOX_DEFAULT_NODE=""
ENV PROXMOX_DEFAULT_STORAGE="local-lvm"

EXPOSE 3002

ENTRYPOINT ["node", "dist/index.js"]
