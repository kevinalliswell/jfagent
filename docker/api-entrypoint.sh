#!/bin/sh
set -eu

mkdir -p /app/knowledge/uploads /app/output/doc /app/src /app/server

npm run kb:build

exec node server-dist/index.js
