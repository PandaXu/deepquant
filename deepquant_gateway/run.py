"""DeepQuant Gateway — standalone CTP/TTS microservice."""
import sys
import uvicorn

def main():
    host = "0.0.0.0"
    port = 8889
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    print(f"🚀 DeepQuant Gateway → http://{host}:{port}")
    uvicorn.run("deepquant_gateway.server:app", host=host, port=port, log_level="info")

if __name__ == "__main__":
    main()
