"""DeepQuant DataRecorder — standalone tick/bar recording service."""
import asyncio
import logging
import sys

from deepquant_datarecorder.buffer import TickBuffer
from deepquant_datarecorder.gateway_ws import GatewayWSClient
from deepquant_datarecorder.writer import DatabaseWriter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("datarecorder")


async def main():
    gateway_url = "http://127.0.0.1:8889"
    batch_interval = 10.0
    batch_size = 200

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--gateway" and i + 1 < len(args):
            gateway_url = args[i + 1]
            i += 2
        elif args[i] == "--interval" and i + 1 < len(args):
            batch_interval = float(args[i + 1])
            i += 2
        elif args[i] == "--batch" and i + 1 < len(args):
            batch_size = int(args[i + 1])
            i += 2
        else:
            i += 1

    print(f"📊 DeepQuant DataRecorder → Gateway: {gateway_url}")
    print(f"   Database: ~/.vntrader/database.db (via get_database)")
    print(f"   Batch: every {batch_interval}s or {batch_size} events")

    writer = DatabaseWriter()
    buffer = TickBuffer(writer, interval=batch_interval, max_size=batch_size)
    client = GatewayWSClient(gateway_url)

    def on_tick(data: dict):
        tick = data.get("data", data)
        buffer.add_tick(tick)

    client.on("eTick.", on_tick, prefix=True)
    await client.start()
    asyncio.create_task(buffer.flush_loop())

    async def stats_loop():
        while True:
            await asyncio.sleep(30)
            logger.info(
                "status ws=%s msgs=%s ticks_in=%s bars_in=%s flushes=%s saved_tick=%s saved_bar=%s",
                client.connected, client.msg_count,
                buffer.stats["ticks_in"], buffer.stats["bars_in"], buffer.stats["flushes"],
                writer.saved_ticks, writer.saved_bars,
            )

    asyncio.create_task(stats_loop())

    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        await client.stop()
        await buffer.flush()
        print("DataRecorder stopped", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
