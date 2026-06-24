# ALAN Monitor server — build context: repository root (MCP Demo System / Docker)
FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

RUN mkdir -p data uploads

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DEPLOY_MODE=LIVE

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3333)+'/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
