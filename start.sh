#!/bin/bash

set -e

# Configuration
PORT=5173
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting server on port $PORT..."

# Change to project directory
cd "$PROJECT_DIR"

# Kill any existing process on the port
if lsof -i ":$PORT" > /dev/null 2>&1; then
  echo "⚠️  Port $PORT is in use. Killing existing process..."
  lsof -i ":$PORT" | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Clean build directory and rebuild
echo "🔨 Cleaning and rebuilding..."
rm -rf dist node_modules/.vite

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Run build
npm run build

# Start development server
echo "✅ Build complete. Starting dev server on port $PORT..."
PORT=$PORT npm run dev
