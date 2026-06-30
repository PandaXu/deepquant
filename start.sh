#!/bin/bash
# DeepQuant — 一键启动全部服务
set -e

VENV="deepquant/.venv/bin/python"
export PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp:deepquant_server"

echo "🚀 DeepQuant 启动中..."

# Gateway (CTP SimNow)
$VENV deepquant_gateway/run.py --instance ctp-simnow &
sleep 5

# Server
$VENV deepquant_server/run.py &
sleep 5

# Web
$VENV deepquant_web/run.py &

echo ""
echo "✅ 全部就绪"
echo "   Gateway :8889"
echo "   Server  :8888"
echo "   Web     http://127.0.0.1:8080"
wait
