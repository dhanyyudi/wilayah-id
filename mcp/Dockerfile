FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies natively
COPY requirements.txt .

# Since we're using the standard mcp package now
RUN echo "mcp\npsycopg2-binary\npydantic\npython-dotenv" > requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy server application
COPY server.py .

# Expose standard port for SSE if needed, though typically FastMCP runs on stdio
# By default, FastMCP runs on stdio.
# The user will likely run it like `docker exec -i ... python server.py`
# Or we can serve it via SSE
CMD ["python", "server.py"]
