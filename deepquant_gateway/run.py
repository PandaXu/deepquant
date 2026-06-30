"""DeepQuant Gateway — standalone CTP/TTS microservice.

Usage:
    python run.py                          # default instance (:8889, official)
    python run.py --instance ctp-simnow    # from gateways.toml
    python run.py --instance tts-openctp   # from gateways.toml
    python run.py --port 8890 --backend tts # manual override
    python run.py --list                   # show configured instances
"""
import sys
import uvicorn
from deepquant_gateway.config import load_config, get_instance


def main():
    host = "0.0.0.0"
    port = 8889
    backend = "official"
    instance_id = ""

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif args[i] == "--instance" and i + 1 < len(args):
            instance_id = args[i + 1]
            i += 2
        elif args[i] == "--backend" and i + 1 < len(args):
            backend = args[i + 1]
            i += 2
        elif args[i] == "--list":
            print("Configured gateway instances:")
            for inst in load_config():
                print(f"  {inst['id']:<20} :{inst['port']:<5} backend={inst['backend']:<10} accounts={inst.get('accounts', [])}")
            return
        else:
            i += 1

    # If instance specified, load from config
    if instance_id:
        cfg = get_instance(instance_id)
        if cfg is None:
            print(f"❌ Unknown instance: '{instance_id}'")
            print("   Use --list to see configured instances")
            sys.exit(1)
        port = cfg["port"]
        backend = cfg.get("backend", "official")
        print(f"📋 Loaded config: {cfg['id']} (backend={backend}, accounts={cfg.get('accounts', [])})")

    # Expose backend setting for the gateway process
    import os
    os.environ["DEEPQUANT_CTP_BACKEND"] = backend

    print(f"🚀 DeepQuant Gateway → http://{host}:{port}  [backend={backend}]")
    uvicorn.run("deepquant_gateway.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
