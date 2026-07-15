FROM node:20-alpine
WORKDIR /app
COPY server.js .
ENV PORT=8787 STATE_DIR=/secrets
VOLUME /secrets
EXPOSE 8787
USER node
CMD ["node", "server.js"]
