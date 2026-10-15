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

GitHub 仓库地址为 [TwinkleStarDust/comfyui-autocomplete-plus-plus-plus](https://github.com/TwinkleStarDust/comfyui-autocomplete-plus-plus-plus)，初次上传设为私有仓库。

Comfy Registry 发布者为 `twinklestar`，已在 `pyproject.toml` 中配置 `PublisherId`。`.github/workflows/publish_action.yml` 仅支持手动触发，使用 GitHub Actions 仓库密钥 `REGISTRY_ACCESS_TOKEN` 发布；此密钥来自本项目发布者账号，不沿用上游身份。上传或更新 GitHub 仓库不会自动发布到 Registry。

保留 [LICENSE](../LICENSE) 中的原作者版权与 MIT 条款，并保留[数据来源](DICTIONARIES.md#数据来源与许可)说明。
