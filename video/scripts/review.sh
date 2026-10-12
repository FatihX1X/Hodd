#!/usr/bin/env bash
# Pulls frames out of a rendered film for review: scripts/review.sh out/hodd-finance-film.mp4 out/review 3 7.9 16.1 ...
set -euo pipefail
film="$1"; dir="$2"; shift 2
mkdir -p "$dir"
for t in "$@"; do ffmpeg -loglevel error -y -ss "$t" -i "$film" -frames:v 1 -vf scale=960:-1 "$dir/t$(printf '%06.2f' "$t").jpg"; done
