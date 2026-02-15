FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Install Tor
RUN apt-get update && apt-get install -y tor && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

# Install Playwright browsers (chromium only to save space)
RUN npx playwright install chromium --with-deps

COPY . .
RUN npm run build

# Create a start script to run both Tor and the Node app
RUN echo "#!/bin/sh" > /app/start.sh && \
    echo "tor &" >> /app/start.sh && \
    echo "npm start" >> /app/start.sh && \
    chmod +x /app/start.sh

# Open port 7860
ENV PORT=7860
EXPOSE 7860

# Start everything
CMD ["/app/start.sh"]
