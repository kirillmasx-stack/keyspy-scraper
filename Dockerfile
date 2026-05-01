FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./
EXPOSE 8080
CMD ["node", "server.js"]
