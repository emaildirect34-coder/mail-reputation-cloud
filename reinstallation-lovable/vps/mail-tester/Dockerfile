FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends rspamd spamassassin spamc spamd && rm -rf /var/lib/apt/lists/*
RUN printf 'bind_socket = "0.0.0.0:11333";\n' > /etc/rspamd/local.d/worker-normal.inc
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY tester.py advanced.py probe_http.py reputation.py ./
CMD ["uvicorn", "tester:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]


