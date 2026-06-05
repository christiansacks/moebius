FROM node:lts-alpine

WORKDIR /app

# Install only the packages the server actually needs.
# express is a devDependency in package.json (client build tool context)
# so we install server deps directly rather than via npm ci.
RUN npm install --no-save \
    ws@8.20 \
    minimist@1.2 \
    upng-js@2.1 \
    fzstd@0.1 \
    express@4.22 \
    discord.js@14.26

COPY server.js ./
COPY app/server.js ./app/
COPY app/hourly_saver.js ./app/
COPY app/libtextmode/ ./app/libtextmode/
COPY app/fonts/ ./app/fonts/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
