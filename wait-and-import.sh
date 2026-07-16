#!/bin/bash
set -a; source .env.local; set +a
echo "$(date -u): quota復活待ち開始"
while true; do
  code=$(curl -s -o /tmp/probe.json -w "%{http_code}" -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"models/gemini-embedding-001","content":{"parts":[{"text":"test"}]},"outputDimensionality":768}')
  if [ "$code" = "200" ]; then
    echo "$(date -u): quota復活を確認、取り込みを開始"
    break
  fi
  echo "$(date -u): まだ429 (http $code)、5分後に再確認"
  sleep 300
done
npx tsx scripts/index-products.ts ./product.csv
