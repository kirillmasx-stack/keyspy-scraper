FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY package.json ./package.json
RUN npm install

COPY server.js ./server.js

EXPOSE 8081

CMD ["node", "server.js"]
