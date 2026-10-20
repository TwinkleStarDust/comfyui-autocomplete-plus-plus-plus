import csv
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from aiohttp import web


spec = importlib.util.spec_from_file_location(
    "dictionary_updater", Path(__file__).resolve().parents[1] / "modules" / "dictionary_updater.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def release_csv(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, quotechar="'", lineterminator="\n")
    writer.writerow(["name", "category", "cn_name", "post_count"])
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


class DictionaryUpdaterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.updater = module.DictionaryUpdater(self.root / "tags", self.root / "data")
        self.body = release_csv([("long_hair", 0, "长发", 500), ("hatsune_miku", 4, "初音未来", 400)])
        self.etag = '"release-1"'
        self.http_status = 200
        self.downloads = 0
        self.heads = 0
        app = web.Application()
        app.router.add_get("/latest/download/tags.csv", self.redirect)
        app.router.add_get("/releases/download/v2026-10-11/tags.csv", self.asset)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.original_url = module.SOURCE_URL
        module.SOURCE_URL = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/latest/download/tags.csv"

    async def asyncTearDown(self):
        if self.updater.task:
            await self.updater.task
        module.SOURCE_URL = self.original_url
        await self.runner.cleanup()
        self.temporary.cleanup()

    async def redirect(self, _request):
        raise web.HTTPFound("/releases/download/v2026-10-11/tags.csv")

    async def asset(self, request):
        if request.method == "HEAD":
            self.heads += 1
        else:
            self.downloads += 1
        return web.Response(body=self.body, status=self.http_status, headers={"ETag": self.etag})

    async def update(self, **options):
        self.updater.start_update(**options)
        await self.updater.task
        return self.updater.status()

    async def test_installs_release_and_persists_version(self):
        status = await self.update()
        self.assertEqual(status["state"], "ready")
        self.assertEqual(status["version"], "v2026-10-11")
        self.assertEqual(status["row_count"], 2)
        self.assertEqual((self.updater.directory / "tags.csv").read_bytes(), self.body)
        with self.updater.output_path.open(encoding="utf-8", newline="") as source:
            self.assertEqual(list(csv.reader(source))[0], ["long_hair", "0", "500", "", "长发"])
        restored = module.DictionaryUpdater(self.root / "tags", self.root / "data")
        self.assertEqual(restored.status()["revision"], status["revision"])
        self.assertFalse(status["auto_update"])

    async def test_check_does_not_download_or_install(self):
        status = await self.update(check_only=True)
        self.assertEqual(status["state"], "missing")
        self.assertFalse(status["installed"])
        self.assertEqual(self.downloads, 0)
        self.assertEqual(self.heads, 1)

    async def test_bundled_snapshot_is_ready_without_network_or_user_state(self):
        await self.update()
        snapshot = {key: self.updater.metadata[key] for key in ("installed", "revision", "row_count")}
        (self.updater.tags_dir / "danbooru_ffdkj.snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")
        self.updater.metadata_path.unlink()
        restored = module.DictionaryUpdater(self.updater.tags_dir, self.root / "data")
        status = restored.ensure()
        self.assertEqual(status["state"], "ready")
        self.assertEqual(status["version"], "v2026-10-11")
        self.assertEqual(status["row_count"], 2)
        self.assertFalse(status["auto_update"])
        self.assertIsNone(restored.task)
        self.updater = restored
        checked = await self.update(check_only=True)
        self.assertFalse(checked["update_available"])
        self.assertEqual(self.downloads, 1)

    async def test_bundled_metadata_does_not_label_a_modified_dictionary(self):
        self.updater.tags_dir.mkdir()
        self.updater.output_path.write_text("custom,0,1,,custom\n", encoding="utf-8")
        snapshot = {"installed": {"version": "bundled"}, "revision": hashlib.sha256(b"different").hexdigest(), "row_count": 10}
        (self.updater.tags_dir / "danbooru_ffdkj.snapshot.json").write_text(json.dumps(snapshot), encoding="utf-8")
        restored = module.DictionaryUpdater(self.updater.tags_dir, self.root / "data")
        self.assertTrue(restored.status()["installed"])
        self.assertIsNone(restored.status()["version"])

    async def test_reuses_running_task_and_skips_unchanged_release(self):
        self.updater.start_update()
        first_task = self.updater.task
        self.updater.start_update()
        self.assertIs(self.updater.task, first_task)
        await first_task
        await self.update()
        self.assertEqual(self.downloads, 1)
        await self.update(force=True)
        self.assertEqual(self.downloads, 2)

    async def test_detects_and_installs_republished_release(self):
        first = await self.update()
        self.body = release_csv([("long_hair", 0, "修订长发", 600)])
        self.etag = '"release-2"'
        checked = await self.update(check_only=True)
        self.assertTrue(checked["update_available"])
        self.assertEqual(checked["revision"], first["revision"])
        self.assertEqual(self.downloads, 1)
        updated = await self.update()
        self.assertFalse(updated["update_available"])
        self.assertNotEqual(updated["revision"], first["revision"])
        self.assertIn("修订长发", self.updater.output_path.read_text(encoding="utf-8"))

    async def test_invalid_download_preserves_working_dictionary_and_can_retry(self):
        first = await self.update()
        original = self.updater.output_path.read_bytes()
        self.etag = '"bad-release"'
        for invalid in (b"<html>error</html>", release_csv([]), release_csv([("bad", 0, "bad", -1)])):
            self.body = invalid
            status = await self.update()
            self.assertEqual(status["state"], "error")
            self.assertTrue(status["installed"])
            self.assertEqual(status["revision"], first["revision"])
            self.assertEqual(self.updater.output_path.read_bytes(), original)
            self.assertEqual(list(self.updater.directory.glob("download-*")), [])
        self.body = release_csv([("long_hair", 0, "长发", 500)])
        self.assertEqual((await self.update())["state"], "ready")

    async def test_http_failure_keeps_local_data(self):
        await self.update()
        self.http_status = 503
        status = await self.update()
        self.assertEqual(status["state"], "error")
        self.assertIn("503", status["error"])
        self.assertTrue(status["installed"])
        self.assertEqual(self.downloads, 1)

    async def test_automatic_updates_are_opt_in_and_limited_to_once_daily(self):
        self.updater.ensure()
        self.assertIsNone(self.updater.task)
        self.updater.configure(True)
        self.updater.ensure()
        await self.updater.task
        first_task = self.updater.task
        self.updater.ensure()
        self.assertIs(self.updater.task, first_task)
        self.assertEqual(self.heads, 1)
        self.updater.metadata["last_attempt"] = 0
        self.updater.ensure()
        await self.updater.task
        self.assertEqual(self.heads, 2)
        self.assertEqual(self.downloads, 1)
        self.updater.configure(False)
        restored = module.DictionaryUpdater(self.root / "tags", self.root / "data")
        self.assertFalse(restored.status()["auto_update"])

    async def test_failed_automatic_attempt_is_not_repeated_on_page_reload(self):
        self.updater.configure(True)
        self.http_status = 503
        self.updater.ensure()
        await self.updater.task
        restored = module.DictionaryUpdater(self.root / "tags", self.root / "data")
        restored.ensure()
        self.assertIsNone(restored.task)
        self.assertEqual(self.heads, 1)

    def test_converts_upstream_quoting_and_retains_existing_aliases(self):
        self.updater.tags_dir.mkdir()
        aliases = self.updater.tags_dir / "danbooru_merged_zh.csv"
        with aliases.open("w", encoding="utf-8", newline="") as target:
            csv.writer(target).writerow(["artist's_name", 1, 99, "old_name,other_name", "旧译名"])
        source = self.root / "release.csv"
        source.write_bytes(b"\xef\xbb\xbf" + release_csv([
            ("artist's_name", 1, '画师, 含"引号"和\n换行', 100),
            ('"double_quotes"', 0, "中文'引号", 10),
        ]))
        result = self.root / "converted.csv"
        self.assertEqual(module.convert_dictionary(source, result, aliases), 2)
        with result.open(encoding="utf-8", newline="") as target:
            rows = list(csv.reader(target))
        self.assertEqual(rows[0], ["artist's_name", "1", "100", "old_name,other_name", '画师, 含"引号"和 换行'])
        self.assertEqual(rows[1][0], '"double_quotes"')
        self.assertEqual(rows[1][4], "中文'引号")


if __name__ == "__main__":
    unittest.main()
