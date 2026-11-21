FROM node:20-slim

Install git & SSL certificates (required by some Baileys/npm dependencies)

RUN apt-get update && apt-get install -y --no-install-recommends 

git 

ca-certificates 

&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

Copy package files first for faster Docker layer caching

COPY package*.json ./

Install production dependencies (works with or without package-lock.json)

RUN npm install --omit=dev

Copy the rest of the application source code

COPY . .

Set default environment variables

ENV NODE_ENV=production
ENV PORT=3000

Northflank automatically detects and exposes this port

EXPOSE 3000

Start the CRP Order Tracker bot

CMD ["node", "server.js"]
