# 模块路径

- `web/js/main.js`：输入框监听、节点识别和插件初始化。
- `web/js/related-tags.js`：相关标签查询、弹窗和插入。
- `web/js/autocomplete.js`：普通标签补全。
- `web/js/hotkeys.js`：快捷键和支持撤销的文本写入。
- `web/js/auto-formatter.js`：提示词格式化。
- `web/css/autocomplete-plus.css`：弹窗样式。
- `modules/`：后端接口、词典更新和相关标签索引读取。
- `tests/`：前后端回归测试。

先读 `HANDOFF.md`。按模块定向搜索。默认跳过 `data/`、`tags/` 和缓存。
修改输入交互时，检查经典画布和 Node 2.0 的焦点差异。
