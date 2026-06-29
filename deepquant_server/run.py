"""
VeighNa Web Trader — FastAPI server launcher.

Usage:
    python run.py                  # default: 0.0.0.0:8888
    python run.py --port 9999      # custom port
    python run.py --host 127.0.0.1 # local only
"""
import sys
import uvicorn


def main():
    host = "0.0.0.0"
    port = 8888

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--host" and i + 1 < len(args):
            host = args[i + 1]
            i += 2
        elif args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        else:
            i += 1

    print(f"🚀 VeighNa Web Trader → http://{host}:{port}")
    uvicorn.run("deepquant_server.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
