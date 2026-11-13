#!/usr/bin/env bash
# Production start on Render's free plan, where one service runs everything (D56): migrate the
# database, then run the worker and the web app side by side. If either stops, the container exits
# and Render restarts it, so a crashed worker can't go unnoticed behind a healthy web app.
set -euo pipefail

bun run db:migrate
bun run worker &
bun run start &
wait -n
exit $?
