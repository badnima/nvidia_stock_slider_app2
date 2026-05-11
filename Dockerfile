FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY data ./data
COPY lib ./lib
COPY public ./public
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
