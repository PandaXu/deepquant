# DeepQuant DataManager

历史数据管理 App，挂载于 Server MainEngine，负责：

- 从 datafeed（PublicDatafeed / RQData 等）下载 K 线、Tick
- 增量更新、同步分钟线
- CSV 导入 / 导出
- 本地 SQLite 数据删除与汇总

## 安装

```bash
pip install -e deepquant_datamanager
```

或通过 Server 可选依赖：

```bash
pip install -e "deepquant_server[datamanager]"
```

## 使用

```python
from deepquant_datamanager import DataManagerApp

main_engine.add_app(DataManagerApp)
```

Web 端通过 `deepquant_server` 的 `/api/data/*` 与 WS `update_bar_data` 等 action 调用。
