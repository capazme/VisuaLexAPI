#!/bin/bash

PORT=${1:-3001}

echo "🔍 Cerco processi sulla porta $PORT..."

PIDS=$(lsof -ti:$PORT)

if [ -z "$PIDS" ]; then
    echo "✅ Nessun processo trovato sulla porta $PORT"
    exit 0
fi

echo "⚠️  Trovati processi: $PIDS"
echo "🔪 Killing..."

lsof -ti:$PORT | xargs kill -9

if [ $? -eq 0 ]; then
    echo "✅ Porta $PORT liberata!"
else
    echo "❌ Errore durante il kill"
    exit 1
fi
