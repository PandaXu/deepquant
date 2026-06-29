"""
DeepQuant Web — static frontend server.
Serves the HTML/JS SPA. The JS connects to deepquant_server via WebSocket.

Usage:
    python run.py                     # serve on :8080, API on :8888
    python run.py --port 3000         # custom web port
    python run.py --api http://1.2.3.4:8888  # remote API server
"""
import http.server
import os
import sys
import socketserver

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
DEFAULT_PORT = 8080


def main():
    port = DEFAULT_PORT
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--port" and i + 1 < len(sys.argv) - 1:
            port = int(sys.argv[i + 2])

    os.chdir(STATIC_DIR)
    handler = http.server.SimpleHTTPRequestHandler

    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"DeepQuant Web → http://0.0.0.0:{port}")
        print(f"  (API server expected on :8888)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
