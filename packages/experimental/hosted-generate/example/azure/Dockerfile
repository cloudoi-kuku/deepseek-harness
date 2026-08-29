FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
ENV NODE_ENV=production
ENV PORT=3081
USER node
EXPOSE 3081
CMD ["node", "server.mjs"]
