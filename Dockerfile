FROM node:22-bookworm-slim

WORKDIR /app

# Install system dependencies
# python3 is retained for native Node addon builds; no OCR/pip packages are installed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    build-essential \
    libcairo2-dev \
    libjpeg62-turbo-dev \
    libpango1.0-dev \
    libgif-dev \
    libpixman-1-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@10.34.5

# Copy package files first for better caching
COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY vendor ./vendor/

# Copy patches directory BEFORE installing dependencies (pnpm needs them)
COPY patches ./patches/

# Install dependencies
RUN echo "Installing dependencies..." && \
    pnpm install --frozen-lockfile && \
    echo "Dependencies installed successfully"

# OCR is disabled; PaddleOCR and its Python dependencies are not installed.

# Copy all source code
COPY . .

# Copy entrypoint script
COPY docker-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Type errors must fail the image build.
RUN pnpm check

# Build application - split into separate steps for better error visibility
RUN echo "Starting vite build..." && \
    pnpm exec vite build

RUN echo "Building embeddable chat widget..." && \
    pnpm exec vite build --config vite.widget.config.ts && \
    test -f dist/public/chat-widget.js && \
    echo "chat-widget.js ready"

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
