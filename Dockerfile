FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    libpng-dev

# Install pnpm globally
RUN npm install -g pnpm@latest

# Copy package files first for better caching
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Copy patches directory BEFORE installing dependencies (pnpm needs them)
COPY patches ./patches/

# Install dependencies
RUN echo "Installing dependencies..." && \
    pnpm install --no-frozen-lockfile && \
    echo "Dependencies installed successfully"

# Copy all source code
COPY . .

# Copy entrypoint script
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Verify TypeScript compilation before build (non-blocking)
RUN echo "Checking TypeScript compilation..." && \
    pnpm check 2>&1 | head -n 50 || echo "TypeScript check completed (warnings may exist)"

# Build application - split into separate steps for better error visibility
RUN echo "Starting vite build..." && \
    pnpm exec vite build

# Copy PDF.js worker to dist/public (Vite plugin may not copy it due to emptyOutDir)
RUN echo "Copying PDF.js worker..." && \
    cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs dist/public/pdf.worker.min.mjs && \
    echo "✅ PDF.js worker copied to dist/public"

RUN echo "Starting esbuild..." && \
    pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Expose port
EXPOSE 3000

# Start application via entrypoint (runs migrations first)
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "start"]
