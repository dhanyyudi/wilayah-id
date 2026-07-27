FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies natively
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server application
COPY server.py .
COPY wilayah_mcp ./wilayah_mcp

# Streamable HTTP deployments listen on this internal container port.
EXPOSE 8000

# The transport is selected explicitly with MCP_TRANSPORT.
CMD ["python", "server.py"]
