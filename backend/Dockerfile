FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies reproducibly from package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Do not run as root
USER node

EXPOSE 3000
CMD ["node", "server.js"]
