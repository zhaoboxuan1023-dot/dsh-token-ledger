# dsh-token-ledger

跨通道统一的 token 用量记账插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

不管当前选的是 DeepSeek 账号、DeepSeek API Key、WorkBuddy 还是其他任何 provider，都会自动记录并按通道、模型、日期汇总。

## 为什么需要它

DSH 内置的用量胶囊只显示**当前会话**的总量，没有通道维度，换会话就归零，也不留历史。本插件把全部会话的用量按通道拆开、长期保留，并在输入框下方实时展示。

## 工作原理

```
会话日志 (~/.dsh/sessions/**/session.v*.jsonl.zstd)
        │  逐帧 zstd 解压
        ▼
   Host: 扫描 → 按 assistant 消息的 usage 聚合
        │  GET /plugins/token-ledger/summary
        ▼
   Client: 输入框下方「用量」胶囊 + 展开面板
```

关键设计：**provider/model 取自每条 assistant 消息自带的 `message.source`**，而不是会话级的 `model/selection`。后者只在顶层会话存在，依赖它会把 subagent 的流量全部记成 `unknown`。

## 指标口径

| 字段 | 含义 |
|---|---|
| 计费合计 | `input + cacheRead + cacheWrite + output` |
| 未缓存输入 | `inputTokens`，未命中缓存的部分 |
| 缓存读取 | `cacheReadTokens`，通常按折扣价计费 |
| 缓存写入 | `cacheWriteTokens` |
| 缓存命中率 | `cacheRead / (input + cacheRead + cacheWrite)` |

> ⚠️ `totalTokens` 是**累计上下文快照**，不是单次消耗，直接相加会得到天文数字。本插件不使用它。

## 安装

```bash
# 1. 放进 profile 的 node_modules（或建 junction）
# 2. 在 profile 的 package.json 里加依赖与 bundle
```

profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-token-ledger": "file:/path/to/dsh-token-ledger"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-token-ledger"]
    }
  }
}
```

本包自带 `cordis.patch.yml`，作为 bundle 时会自动插入 loader 行——**不要再手动往 profile 的 patch 里写同名 insert**，否则会报 `duplicate loader entry id`。

安装后重启 DSH Desktop（client bundle 在启动时扫描）。

## 已知限制

- 只读本地会话日志，**不联网**，不上传任何数据
- 扫描是惰性的：面板打开时按需聚合，1.5 秒缓存
- 未回传 `usage` 的回复会单独计入「未计量」分区，不会静默漏算
- 目前只统计 `assistant/message`，工具结果不单独计费

## 许可

MIT
