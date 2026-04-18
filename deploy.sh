#!/bin/bash
# deploy.sh — SolarLead Deployment via GitHub
# Ausführen als root auf dem Server: bash /opt/solarlead/deploy.sh

set -e

echo "🚀 SolarLead Deploy gestartet..."

cd /opt/solarlead

echo "📥 Git Pull..."
git pull origin master

echo "📦 npm install..."
npm install --omit=dev 2>/dev/null || npm install

echo "🔨 Build..."
npm run build

echo "🔁 PM2 Restart..."
pm2 restart solarlead --update-env

echo "✅ Deploy abgeschlossen!"
pm2 status
