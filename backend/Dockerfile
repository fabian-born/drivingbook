FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Abhängigkeiten reproduzierbar aus package-lock.json installieren
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Nicht als root laufen
USER node

EXPOSE 3000
CMD ["node", "server.js"]
