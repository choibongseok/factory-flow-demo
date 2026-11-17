"""Starts broker, simulator and API in one container and exits if any of them dies (the host restarts it).

The MQTT path is the real one: simulator -> Mosquitto (127.0.0.1 only) -> API subscription.
"""
import os
import signal
import subprocess
import sys
import time

PORT = os.getenv("PORT", "8000")


def commands(env: dict[str, str]) -> list[tuple[str, list[str]]]:
    return [
        ("mosquitto", ["mosquitto", "-c", "/etc/mosquitto/factory.conf"]),
        ("simulator", [sys.executable, "-m", "sim.main"]),
        ("api", [sys.executable, "-m", "uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", env.get("PORT", "8000"),
                 "--proxy-headers", "--forwarded-allow-ips", "*"]),
    ]


def main() -> int:
    env = {**os.environ, "MQTT_HOST": "127.0.0.1", "MQTT_PORT": "1883"}
    procs: list[tuple[str, subprocess.Popen]] = []

    def stop(*_):
        for _, p in procs:
            if p.poll() is None:
                p.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    for name, cmd in commands(env):
        cwd = {"simulator": "/srv/simulator", "api": "/srv/api"}.get(name)
        procs.append((name, subprocess.Popen(cmd, env=env, cwd=cwd)))
        if name == "mosquitto":
            time.sleep(0.5)  # the clients retry anyway; this just avoids a noisy first failure
    while True:
        for name, p in procs:
            code = p.poll()
            if code is not None:
                print(f"[launcher] {name} exited with {code}; shutting down", flush=True)
                stop()
                for _, q in procs:
                    q.wait(timeout=10)
                return code or 1
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
