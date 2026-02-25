FROM node:22-bookworm-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pandas \
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
RUN npm install -g pnpm@latest

# Copy package files first for better caching
COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY scripts/table_extractor_requirements.txt ./scripts/table_extractor_requirements.txt

# Copy patches directory BEFORE installing dependencies (pnpm needs them)
COPY patches ./patches/

# Install dependencies
RUN echo "Installing dependencies..." && \
    pnpm install --no-frozen-lockfile && \
    echo "Dependencies installed successfully"

# Install optional Python dependencies for advanced table extraction
# (Camelot lattice + rapidfuzz + pdfplumber fallback)
RUN if [ -f scripts/table_extractor_requirements.txt ]; then \
      echo "Installing Python table extractor dependencies..." && \
      python3 -m pip install --no-cache-dir --prefer-binary --break-system-packages -r scripts/table_extractor_requirements.txt; \
    else \
      echo "No table extractor requirements found, skipping."; \
    fi

# Copy all source code
COPY . .

# Copy entrypoint script
COPY docker-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

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
