FROM node:24-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/potatoes.db
EXPOSE 8080
# /data is the persistent volume: the database and (optionally) releases
CMD ["node", "server.js"]
