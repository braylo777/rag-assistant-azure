FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server ./server
COPY evals ./evals
COPY test/support ./test/support
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server/node.mjs"]
