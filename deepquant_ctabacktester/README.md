# deepquant_ctabacktester

DeepQuant CTA 策略回测模块。

## 安装

```bash
# 仓库根目录 editable 安装（推荐）
pip install -e deepquant_ctabacktester

# 或加入 PYTHONPATH（start.sh 已包含）
export PYTHONPATH="...:deepquant_ctabacktester"
```

## 使用

| 场景 | 方式 |
|------|------|
| Web 策略回测 | Server WS `start_backtesting`，见 `deepquant_web` |
| Desktop | `from deepquant_ctabacktester import CtaBacktesterApp` |
| 文档 | `deepquant/docs/community/app/cta_backtester.md` |

依赖：`deepquant` 核心库 + `vnpy_ctastrategy`（策略模板）。
