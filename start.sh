#!/bin/bash
# DeepQuant — 一键启动全部服务
set -e

VENV="deepquant/.venv/bin/python"
export PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp:deepquant_server:deepquant_datarecorder:deepquant_datamanager:deepquant_ctabacktester"

# 释放常用端口，避免重复启动冲突
for p in 8080 8888 8889 8890 8900; do
  lsof -ti :$p 2>/dev/null | xargs kill -9 2>/dev/null || true
done
sleep 1

echo "🚀 DeepQuant 启动中..."

# Gateway 1: CTP official (SimNow)
$VENV deepquant_gateway/run.py --instance ctp-simnow &
sleep 5

# Gateway 2: TTS (OpenCTP)
$VENV deepquant_gateway/run.py --instance tts-openctp &
sleep 5

# Server
$VENV deepquant_server/run.py &
sleep 5

# DataRecorder — 录制 tick + 1m K 线到 ~/.vntrader/database.db
$VENV deepquant_datarecorder/run.py --gateway http://127.0.0.1:8889 &
sleep 2

# Web
$VENV deepquant_web/run.py &

echo ""
echo "✅ 全部就绪"
echo "   Gateway CTP :8889 (official)"
echo "   Gateway TTS :8890 (tts)"
echo "   Server      :8888"
echo "   DataRecorder (Gateway WS, 写入 database.db)"
echo "   Web         http://127.0.0.1:8080"
wait
