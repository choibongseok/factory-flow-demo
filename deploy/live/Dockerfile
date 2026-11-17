# One container: Mosquitto (localhost only) + simulator + API. Build context = repository root.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends mosquitto && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY api/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt
COPY api/app /srv/api/app
COPY simulator/sim /srv/simulator/sim
COPY deploy/live/mosquitto.conf /etc/mosquitto/factory.conf
COPY deploy/live/run.py /srv/run.py
ENV PORT=8000
EXPOSE 8000
CMD ["python", "/srv/run.py"]
