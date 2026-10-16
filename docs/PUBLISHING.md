# GitHub 发布说明

[项目首页](../README.md) · [使用指南](../README_zh.md) · [词库与索引](DICTIONARIES.md)

## 仓库内容


以本插件目录作为仓库内容组织，文档和截图使用相对路径，上传后可直接显示。

```text
comfyui-autocomplete-plus-plus-plus/
├── README.md
├── README_zh.md
├── docs/
├── LICENSE
├── __init__.py
├── pyproject.toml
├── assets/
├── locales/zh/
├── modules/
├── web/
├── scripts/build_related_index.py
├── tags/
│   ├── danbooru.csv
│   ├── danbooru_merged_zh.csv
│   └── translations/danbooru_zh.csv
└── data/
    └── danbooru_related.sqlite3
```

## 翻译文件与个人数据

`.gitignore` 已为 `tags/translations/danbooru_zh.csv` 添加例外，正常提交即可同时上传独立中文翻译。其他个人翻译文件默认忽略；需要发布时可显式加入：

```bash
git add -f tags/translations/your_dictionary.csv
```

五列主词库已包含译名，也可通过「标签翻译文件：无」直接使用内嵌译名。

关联索引需要单独随仓库或下载包提供，或者由使用者按[索引说明](DICTIONARIES.md#关联索引构建)构建。若发布包不包含该文件，请在下载说明中注明。`data/user_data.json` 保存个人设置与标签使用历史，已被忽略，不应作为公共词库发布。

## 项目与 Registry 元数据

`pyproject.toml` 的项目名为 `comfyui-autocomplete-plus-plus-plus`，显示名为 `Autocomplete+++`；来源链接以 `Upstream` 标注原项目。内部设置 ID、节点类型和本地 API 路径沿用原标识，以兼容已有配置与工作流。

GitHub 仓库地址为 [TwinkleStarDust/comfyui-autocomplete-plus-plus-plus](https://github.com/TwinkleStarDust/comfyui-autocomplete-plus-plus-plus)，是原项目的公开 Fork。2026-10-16 完成 Fork 迁移，保留原有提交、`v1.0.0` 标签及 Release 附件；迁移前的独立仓库已[归档备份](https://github.com/TwinkleStarDust/comfyui-autocomplete-plus-plus-plus-backup-20261016)。

[Comfy Registry 项目页](https://registry.comfy.org/zh/publishers/twinklestar/nodes/comfyui-autocomplete-plus-plus-plus)用于查看版本及检查状态。Fork 迁移沿用原插件 ID、发布者 `twinklestar` 和 `v1.0.0` 安装包，仓库链接保持相同地址，继续指向当前 Fork。

Comfy Registry 发布者为 `twinklestar`，已在 `pyproject.toml` 中配置 `PublisherId`。`.github/workflows/publish_action.yml` 仅支持手动触发，使用 GitHub Actions 仓库密钥 `REGISTRY_ACCESS_TOKEN` 发布；此密钥来自本项目发布者账号，不沿用上游身份。上传或更新 GitHub 仓库不会自动发布到 Registry。

保留 [LICENSE](../LICENSE) 中的原作者版权与 MIT 条款，并保留[数据来源](DICTIONARIES.md#数据来源与许可)说明。

## Registry 扫描状态

截至 2026-10-16，`v1.0.0` 的自动扫描状态为 `Flagged`，尚未标记为检查通过。扫描记录命中以下调用：

- `modules/related_tags.py` 与 `scripts/build_related_index.py` 中的 `sqlite3.connect()`，用于读取本地关联词索引及离线构建索引。
- `web/js/workflow-sound.js` 中的 Web Audio `.connect()`，用于连接浏览器内的音频节点、合成提示音。

扫描规则将这些调用归为数据库或网络操作。Registry 安装接口已确认可返回 `v1.0.0` 下载地址；Manager 的最终可见性和安装权限取决于其版本及安全策略。可按首页的 [Manager 安装说明](../README.md#通过-comfyui-manager-安装)尝试，或使用 ZIP 安装。扫描标记需由平台复核，仓库迁移不会自动解除。
