import asyncio
import csv
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import aiohttp


SOURCE_URL = (
    "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
    "/releases/latest/download/tags.csv"
)
FILENAME = "danbooru_ffdkj.csv"
UPDATE_INTERVAL = 24 * 60 * 60
MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024


def convert_dictionary(source_path, output_path, aliases_path=None):
    aliases = {}
    if aliases_path and Path(aliases_path).is_file():
        with open(aliases_path, encoding="utf-8-sig", newline="") as source:
            for row in csv.reader(source):
                if len(row) >= 4 and row[3]:
                    aliases[row[0]] = row[3].replace("\r", " ").replace("\n", " ")

    count = 0
    with open(source_path, encoding="utf-8-sig", newline="") as source, open(
        output_path, "w", encoding="utf-8", newline=""
    ) as target:
        # ffdkj release exports use single quotes, including doubled apostrophes.
        reader = csv.DictReader(source, quotechar="'", strict=True)
        if reader.fieldnames != ["name", "category", "cn_name", "post_count"]:
            raise ValueError("Unexpected ffdkj CSV header")
        writer = csv.writer(target, lineterminator="\n")
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Invalid ffdkj CSV row {line}")
            name = row["name"].strip()
            category = int(row["category"])
            post_count = int(row["post_count"])
            if not name or "\n" in name or "\r" in name or category not in {0, 1, 3, 4, 5} or post_count < 0:
                raise ValueError(f"Invalid ffdkj tag at row {line}")
            translation = row["cn_name"].replace("\r", " ").replace("\n", " ").strip()
            writer.writerow([name, category, post_count, aliases.get(name, ""), translation])
            count += 1
    if not count:
        raise ValueError("The ffdkj dictionary contains no tags")
    return count


class DictionaryUpdater:
    def __init__(self, tags_dir, data_dir):
        self.tags_dir = Path(tags_dir)
        self.directory = Path(data_dir) / "ffdkj"
        self.output_path = self.tags_dir / FILENAME
        self.metadata_path = self.directory / "metadata.json"
        try:
            self.metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            if not isinstance(self.metadata, dict):
                self.metadata = {}
        except (OSError, ValueError):
            self.metadata = {}
        if self.output_path.is_file() and not self.metadata.get("installed"):
            try:
                snapshot = json.loads((self.tags_dir / "danbooru_ffdkj.snapshot.json").read_text(encoding="utf-8"))
                if snapshot["revision"] == hashlib.sha256(self.output_path.read_bytes()).hexdigest():
                    self.metadata.update(snapshot)
            except (OSError, ValueError, KeyError):
                pass
        self.state = "ready" if self.output_path.is_file() else "missing"
        self.error = None
        self.downloaded_bytes = 0
        self.total_bytes = 0
        self.task = None

    def status(self):
        installed = self.output_path.is_file()
        return {
            "state": self.state,
            "installed": installed,
            "filename": FILENAME,
            "auto_update": self.metadata.get("auto_update", False),
            "version": self.metadata.get("installed", {}).get("version"),
            "revision": self.metadata.get("revision"),
            "row_count": self.metadata.get("row_count", 0),
            "last_checked": self.metadata.get("last_checked"),
            "last_updated": self.metadata.get("last_updated"),
            "update_available": installed and bool(self.metadata.get("remote"))
            and self.metadata.get("remote") != self.metadata.get("installed"),
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "error": self.error,
        }

    def configure(self, auto_update):
        self.metadata["auto_update"] = auto_update
        self._save_metadata()
        return self.status()

    def ensure(self):
        if self.metadata.get("auto_update") and time.time() - self.metadata.get("last_attempt", 0) >= UPDATE_INTERVAL:
            return self.start_update()
        return self.status()

    def start_update(self, check_only=False, force=False):
        if self.task and not self.task.done():
            return self.status()
        self.state = "checking"
        self.error = None
        self.downloaded_bytes = self.total_bytes = 0
        self.task = asyncio.create_task(self._update(check_only, force))
        return self.status()

    async def _remote_info(self, session):
        async with session.head(SOURCE_URL, allow_redirects=True) as response:
            response.raise_for_status()
            return self._response_info(response)

    @staticmethod
    def _response_info(response):
        version = ""
        for redirect in (*response.history, response):
            path = unquote(urlparse(str(redirect.url)).path)
            if "/releases/download/" in path:
                version = path.split("/releases/download/", 1)[1].rsplit("/", 1)[0]
        info = {
            "version": version,
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "size": int(response.headers.get("Content-Length", 0)),
        }
        if not info["etag"] and not info["last_modified"]:
            raise ValueError("GitHub did not return a dictionary version")
        return info

    async def _update(self, check_only, force):
        try:
            self.metadata["last_attempt"] = time.time()
            self._save_metadata()
            timeout = aiohttp.ClientTimeout(total=600, connect=20, sock_read=60)
            async with aiohttp.ClientSession(
                timeout=timeout, trust_env=True,
                headers={"User-Agent": "ComfyUI-Autocomplete-Plus-Plus-Plus"},
            ) as session:
                remote = await self._remote_info(session)
                self.metadata.update(remote=remote, last_checked=time.time())
                self._save_metadata()
                if not check_only and (force or not self.output_path.is_file() or remote != self.metadata.get("installed")):
                    await self._download_and_install(session)
            self.state = "ready" if self.output_path.is_file() else "missing"
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError, csv.Error) as error:
            self.state = "error"
            self.error = str(error) or type(error).__name__

    async def _download_and_install(self, session):
        self.state = "downloading"
        self.tags_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="download-", dir=self.directory) as temporary:
            source_path = Path(temporary) / "tags.csv"
            converted_path = Path(temporary) / FILENAME
            async with session.get(SOURCE_URL) as response:
                response.raise_for_status()
                self.total_bytes = int(response.headers.get("Content-Length", 0))
                if self.total_bytes > MAX_DOWNLOAD_BYTES:
                    raise ValueError("Dictionary download exceeds 128 MiB")
                with source_path.open("wb") as target:
                    async for chunk in response.content.iter_chunked(256 * 1024):
                        self.downloaded_bytes += len(chunk)
                        if self.downloaded_bytes > MAX_DOWNLOAD_BYTES:
                            raise ValueError("Dictionary download exceeds 128 MiB")
                        target.write(chunk)
                if self.total_bytes and self.downloaded_bytes != self.total_bytes:
                    raise ValueError("Incomplete dictionary download")
                # Use the downloaded asset's identity if a release changed during the check.
                self.metadata["remote"] = self._response_info(response)
                self.metadata["remote"]["size"] = self.downloaded_bytes
            self.state = "converting"
            row_count = await asyncio.to_thread(
                convert_dictionary, source_path, converted_path, self.tags_dir / "danbooru_merged_zh.csv"
            )
            revision = await asyncio.to_thread(self._file_hash, converted_path)
            os.replace(source_path, self.directory / "tags.csv")
            os.replace(converted_path, self.output_path)
            self.metadata.update(
                installed=dict(self.metadata["remote"]), revision=revision,
                row_count=row_count, last_updated=time.time(),
            )
            self._save_metadata()

    @staticmethod
    def _file_hash(path):
        with open(path, "rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest()

    def _save_metadata(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.metadata_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.metadata_path)
