FROM node:18-alpine

# Installation des outils réseau pour debugging
RUN apk add --no-cache iproute2 net-tools

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Utilisateur non-root pour la sécurité
RUN addgroup -g 1000 wol && \
    adduser -D -u 1000 -G wol wol && \
    chown -R wol:wol /app

USER wol

EXPOSE 3000

CMD ["node", "src/server.js"]