"""
DeepQuant Desktop — launch script.

Starts the backend server as a subprocess, then launches the Qt GUI.
Both desktop and web frontends share the same server on port 8888.

Usage:
    python run.py                     # auto-start server + GUI
    python run.py --server-only       # start server only
    python run.py --client-only       # connect to already-running server
"""
import subprocess
import sys
import time
from urllib.request import urlopen
from urllib.error import URLError

from deepquant_desktop import create_qapp, MainWindow
from deepquant_desktop.api_client import ApiClient

SERVER_PORT = 8888
SERVER_URL = f"http://127.0.0.1:{SERVER_PORT}"


def wait_for_server(timeout: float = 15.0) -> bool:
    """Poll /api/status until the server responds."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = urlopen(f"{SERVER_URL}/api/status", timeout=2)
            data = resp.read().decode()
            if '"status":"online"' in data or "'status': 'online'" in data:
                return True
        except (URLError, OSError):
            pass
        time.sleep(0.5)
    return False


def main():
    args = set(sys.argv[1:])
    server_only = "--server-only" in args
    client_only = "--client-only" in args

    # 1. Start backend server (unless --client-only)
    server_proc = None
    if not client_only:
        print("Starting DeepQuant Server...")
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "deepquant_server.server"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if not wait_for_server():
            print("ERROR: Server failed to start")
            server_proc.kill()
            sys.exit(1)
        print(f"Server ready on {SERVER_URL}")

    if server_only:
        print("Server running. Press Ctrl+C to stop.")
        try:
            server_proc.wait() if server_proc else time.sleep(999999)
        except KeyboardInterrupt:
            pass
        return

    # 2. Launch Qt GUI
    qapp = create_qapp()
    api = ApiClient(SERVER_URL)

    main_window = MainWindow(api)
    main_window.showMaximized()

    # Connect WebSocket after event loop starts (it's async)
    api.connect_to_server()

    try:
        qapp.exec()
    finally:
        api.disconnect_from_server()
        if server_proc:
            server_proc.terminate()
            server_proc.wait(timeout=5)


if __name__ == "__main__":
    main()
