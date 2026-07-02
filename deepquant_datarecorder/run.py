"""DeepQuant DataRecorder — standalone tick/bar recording service.

Usage:
    python run.py                                      # default :8900
    python run.py --gateway http://127.0.0.1:8889      # connect to specific gateway
    python run.py --port 8901                           # custom port
"""
import sys
import asyncio
import logging
from deepquant_datarecorder.gateway_ws import GatewayWSClient
from deepquant_datarecorder.buffer import TickBuffer
from deepquant_datarecorder.writer import DatabaseWriter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("datarecorder")


async def main():
    gateway_url = "http://127.0.0.1:8889"

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--gateway" and i + 1 < len(args):
            gateway_url = args[i + 1]
            i += 2
        else:
            i += 1

    print(f"📊 DeepQuant DataRecorder → Gateway: {gateway_url}")
    print(f"   Database: ~/.vntrader/database.db")

    writer = DatabaseWriter()
    buffer = TickBuffer(writer, interval=10.0, max_size=200)
    client = GatewayWSClient(gateway_url)

    def on_tick(data: dict):
        tick = data.get("data", data)
        buffer.add_tick(tick)

    client.on("eTick.", on_tick)
    await client.start()
    asyncio.create_task(buffer.flush_loop())

    # Keep running
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        await client.stop()
        await buffer.flush()
        print("DataRecorder stopped")


if __name__ == "__main__":
    asyncio.run(main())
