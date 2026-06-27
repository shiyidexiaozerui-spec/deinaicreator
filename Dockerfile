# Universal container image — deploy on Fly.io, Railway, Cloud Run, any Docker host.
FROM node:24-slim

WORKDIR /app

# install runtime deps (express + qrcode; node:sqlite is built in, no native build)
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=4600
EXPOSE 4600

CMD ["npm", "start"]
