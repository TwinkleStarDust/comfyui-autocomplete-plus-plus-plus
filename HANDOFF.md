# 相关标签插入

## 2026-11-05

- 经典画布的外层指针事件会抢走输入焦点。相关标签面板原先只取消 `mousedown` 的默认行为，没有阻止事件冒泡。失焦处理可能在按钮 `click` 前关闭面板并清空目标。
- `web/js/related-tags.js` 现在对面板的 `pointerdown` 和 `mousedown` 保持焦点并阻止冒泡。`mouseup` 和 `click` 只阻止冒泡，保留百科链接的默认行为。普通补全窗口已使用同类处理。
- 不改标签格式化、节点值同步或后端接口。前端文件更新后，需刷新 ComfyUI 页面才能载入。
- `tests/related-tags-focus.test.mjs` 覆盖按下后延迟点击、事件隔离、固定面板连续插入和已有标签去重。修复前两项失败，修复后通过。
- 完整前端测试：`node --experimental-vm-modules --test tests/*.test.mjs`。本次 16 项全部通过。词典重载测试需要 VM Modules 参数。
- 浏览器中已观察经典节点点击时焦点转移。未刷新用户正在使用的页面，未完成刷新后两种节点模式的整体验证。
