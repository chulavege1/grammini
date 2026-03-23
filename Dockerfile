# В этом образе нет ни Rust, ни Node.js - только среда для запуска!
FROM debian:bullseye-slim
WORKDIR /app

RUN apt-get update && apt-get install -y ca-certificates libssl1.1 sqlite3 && rm -rf /var/lib/apt/lists/*

# Копируем только то, что уже собрано
COPY gemini-live /app/server
COPY frontend/ /app/frontend/

RUN mkdir -p /app/logs
ENV PORT=10000
ENV BIND_ADDRESS=0.0.0.0:$PORT
ENV STATIC_DIR=./frontend
ENV RUST_LOG="info"
RUN chmod +x /app/server

EXPOSE 10000
CMD ["/app/server"]
