# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        libgl1-mesa-dev \
        libgles2-mesa-dev \
        libosmesa6-dev \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
        libxi-dev \
        libxinerama-dev \
        libxrandr-dev \
        pkg-config \
        python3 \
        python-is-python3 \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libcairo2 \
        libgif7 \
        libgl1 \
        libgles2 \
        libjpeg62-turbo \
        libosmesa6 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        librsvg2-2 \
        libxi6 \
        libxinerama1 \
        libxrandr2 \
        python3 \
        python-is-python3 \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/bots && chown -R node:node /app/bots

USER node

EXPOSE 8080 3000 3001 3002 3003

CMD ["npm", "start"]
