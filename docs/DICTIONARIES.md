# 词库与关联索引

[项目首页](../README.md) · [使用指南](../README_zh.md) · [发布说明](PUBLISHING.md)

本文说明当前 CSV 快照、译名来源及本地关联索引的维护方式。日常搜索和界面操作见使用指南。默认主词库为 `danbooru_merged_zh.csv`，本项目 Danbooru 词库截止至 **2026.10.12**。

[文件与格式](#词库文件与格式) · [合并与保留规则](#合并来源与翻译保留规则) · [关联索引构建](#关联索引构建)

## 词库文件与格式

### 当前提供的文件

| 文件 | 用途 | 当前快照 |
| --- | --- | --- |
| [`tags/danbooru_merged_zh.csv`](../tags/danbooru_merged_zh.csv) | 五列合并主词库，内嵌译名 | 296,884 条去重标签 |
| [`tags/translations/danbooru_zh.csv`](../tags/translations/danbooru_zh.csv) | 与主词库第五列同步的两列翻译 | 296,884 条 |
| [`tags/danbooru.csv`](../tags/danbooru.csv) | 上游原有主词库，保留作为可选项 | 140,782 条 |

合并文件均为 **UTF-8 无 BOM、无表头**。下文的列定义是说明文字，不应作为数据行加入文件。

### 五列主词库

列顺序为 `tag,category,post_count,aliases,translation`：

| 列 | 内容 |
| --- | --- |
| 第 1 列 `tag` | 英文标准标签，主词库使用下划线拼写 |
| 第 2 列 `category` | Danbooru 分类编号 |
| 第 3 列 `post_count` | 投稿数；缺少元数据时可能为 `0` |
| 第 4 列 `aliases` | 用英文逗号分隔的别名列表 |
| 第 5 列 `translation` | 显示译名，可含多个原名、译名或别名 |

实际数据示例：

```csv
hirasawa_yui,4,8975,"yuihirasawa,ゆいあず,平沢唯","平沢唯,ゆいあず,yuihirasawa"
```

字段内含逗号时需要外层双引号；字段自身的双引号需要写成两个双引号。请使用符合 CSV 规则的工具处理，不要直接按逗号拆分整行。

类别编号见[类别与颜色](../README_zh.md#类别与颜色)。

插件也兼容上游四列格式 `tag,category,post_count,aliases`；没有第五列时可通过独立翻译文件提供译名。

### 两列独立翻译

列顺序为 `tag,translation`：

```csv
hirasawa_yui,"平沢唯,ゆいあず,yuihirasawa"
```

主词库和同步翻译文件均采用下划线拼写。运行时的翻译查找会统一处理大小写以及下划线 / 空格差异，因此也可读取空格形式的翻译键。

独立翻译文件中的非空译文覆盖词库内嵌译文。使用旧版三列格式 `tag,type_or_count,translation` 时，需开启「旧版三列翻译格式」；本分支也支持从五列文件读取第五列作为独立翻译。

### 自定义与重新加载

1. 将主词库或附加词库 CSV 放到 `tags/`。
2. 将独立翻译 CSV 放到 `tags/translations/`。
3. 在设置中选择对应文件；必要时重启后端并刷新页面以更新文件列表和浏览器缓存。
4. 检查当前工作流的词典控制器是否覆盖了全局选择。

保存时选择 UTF-8，不要保存为系统 ANSI / GBK。建议保留原文件副本，避免表格软件把标签或数值自动改写。

Wiki 识别和关联标签功能依赖词库来源，Danbooru 词库文件名应包含 `danbooru`；e621 词库文件名应包含 `e621`。

## 合并来源与翻译保留规则

当前合并快照使用以下四份输入：

| 输入 | 来源 | 输入行数 |
| --- | --- | --- |
| `danbooru.csv` | 原 Autocomplete++ 安装中的主词库 | 140,782 |
| `danbooru_tags.csv` | 原版 Autocomplete-Plus 两列词库 | 231,462 |
| `danbooru_tags_meta.csv` | 原版 Autocomplete-Plus 元数据词库 | 32,260，含表头 |
| `danbooru-ja.csv` | [tagdb-updater / dist](https://github.com/PYU224/tagdb-updater/tree/main/dist) | 187,719 |

其中 tagdb-updater 快照生成于 **2026.10.12**。上述行数为本次输入统计，不代表这些项目今后的数据量；合并后的去重标签数为 **296,884**。

### 翻译保留优先级

合并时只规范化匹配键，不对已有译文做语言筛选或改写：

1. `danbooru_tags_meta.csv` 第四列有非空名称 / 别名时，整段原样保留。
2. 否则，使用 `danbooru_tags.csv` 第二列的非空内容，原样保留。
3. 原版 Plus 中已有但缺少译文的标签保留英文原名，本次共 192 条。
4. 仅对原版 Plus 两份词库中都不存在的新标签补充机器翻译；优先利用日文名称，没有日文名称时使用英文标签。当前输出复用已有 Google Translate 日文 / 英文到简体中文缓存，部分词条仍保留原名。

因此已有的 `平沢唯,ゆいあず,yuihirasawa` 会完整保留，日文假名、韩文及拉丁字母别名不会因不属于中文而被删去。

本次有 **231,771** 条非空已有译名精确保留。机器翻译只用于新增标签，并非对全部词条重译，也不代表专名已经人工校对。

### 投稿数、分类与别名

- 投稿数和类别优先使用本次 tagdb-updater 的元数据，再使用本地可用数据。
- 四个来源的别名合并去重。
- 仅出现在旧翻译表中的标签可能没有投稿数，此时为 `0`。
- 缺少分类时，使用可唯一确定的别名关系和本地画师标记补充；无法确定的归入一般类 `0`。
- 独立 `danbooru_zh.csv` 与主词库第五列保持同步。

这是多源合并快照；分类、投稿数和译名的覆盖程度不同。它不会在插件运行时自动下载最新数据或自动翻译新标签。

## 关联索引构建

### 数据与运行方式

关联面板来自原版 Autocomplete-Plus 的功能移植，使用本地 SQLite 查询共现关系，再结合当前 Danbooru 词库中的投稿数计算 Jaccard 相似度。

当前索引：

| 项目 | 内容 |
| --- | --- |
| 文件 | `data/danbooru_related.sqlite3` |
| 大小 | 约 83 MiB |
| 共现关系 | 3,236,959 对 |
| 覆盖标签 | 31,060 个 |
| 输入 CSV | `danbooru_tags_cooccurrence.csv` |

普通标签搜索使用 CSV，关联面板使用另一份共现索引。某个标签能补全，并不代表共现索引中也有它的关联记录。当前词库中未加载的标签也不会作为关联候选显示。

Jaccard 使用 `共现数 / (标签 A 投稿数 + 标签 B 投稿数 - 共现数)`。投稿统计与共现数据可能来自不同日期，显示的相似度用于辅助选择。

### 从 CSV 生成

准备原版 Autocomplete-Plus 的 `danbooru_tags_cooccurrence.csv`。输入必须包含表头 `tag_a,tag_b,count`。

在本插件根目录执行，Python 可使用运行 ComfyUI 的解释器：

```bash
python scripts/build_related_index.py "../comfyui-autocomplete-plus/data/danbooru_tags_cooccurrence.csv"
```

上例假设两个插件是 `custom_nodes/` 下的相邻目录；如果 CSV 位于其他位置，请将参数替换为其实际路径。

构建脚本使用 Python 3.11 及以上版本的标准库，默认输出到本插件的 `data/danbooru_related.sqlite3`。也可显式指定输出路径：

```bash
python scripts/build_related_index.py "../comfyui-autocomplete-plus/data/danbooru_tags_cooccurrence.csv" --output "data/danbooru_related.sqlite3"
```

脚本会生成临时数据库，构建成功后替换输出文件，并打印行数、关系数和源文件哈希。它不会修改输入 CSV，也不会下载共现数据。

生成后重启 ComfyUI 后端并刷新页面。若仅需普通补全，可以关闭关联标签功能；普通补全不依赖此索引。

面板的触发、插入和布局操作见[关联标签面板](../README_zh.md#关联标签面板)。

## 数据来源与许可

原版 Plus 指 [newtextdoc1111 / ComfyUI-Autocomplete-Plus](https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus)。上游与第三方数据来源汇总见[项目致谢](../README.md#项目来源与致谢)。

代码使用 MIT 许可，第三方词库和共现数据按各自来源说明使用。更换数据后，请同步更新快照日期、统计和来源记录。
