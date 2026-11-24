"""Chromium checks for rendering against intercepted same-origin responses."""
import argparse
import hashlib
import re
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from contenthub_mock_browser_check import QuietStaticHandler, button


RECORDS = "/api/nocodb/tables/mSyntheticProduction/records"
RENDER = "/api/n8n/render-video"
VIDEO = "/media/current.mp4"
INITIAL = {
    "id": 6, "source_name": "合成信源", "track_tag": "main_overseas",
    "raw_title": "Synthetic render fixture", "zh_title": "合成渲染测试稿",
    "url": "https://source.example.invalid/mock", "key_data_points": "合成素材",
    "suggested_titles": [], "score": 4, "compliance_risk": "低风险",
    "workflow_status": "待人工审核", "ai_outline": None, "is_benchmark": False,
    "published_at": "", "created_at": "2025-01-01T00:00:00Z",
    "draft_md": "合成原稿", "video_script": "合成口播", "remotion_data": None,
    "render_job_id": "qa-old", "render_status": "failed", "render_error": "模拟上一任务失败",
    "video_url": "", "cards_urls": [],
}


class Workflow:
    def __init__(self, base):
        self.base = urlsplit(base)
        self.row = INITIAL.copy()
        self.requests = []
        self.unexpected = []
        self.failed_reads = 0

    def route(self, route):
        request = route.request
        url = urlsplit(request.url)
        method = request.method
        path = url.path
        if (url.scheme, url.netloc) == (self.base.scheme, self.base.netloc):
            if method == "GET" and path == RECORDS:
                other = dict(INITIAL, id=7, zh_title="第二份合成稿")
                route.fulfill(json={"list": [self.row, other], "pageInfo": {"isLastPage": True, "totalRows": 2}})
                return
            if method == "GET" and path == RECORDS + "/6":
                if self.failed_reads:
                    self.failed_reads -= 1
                    route.fulfill(status=503, json={"message": "synthetic read failure"})
                else:
                    route.fulfill(json=self.row)
                return
            if method == "PATCH" and path == RECORDS:
                patch, = request.post_data_json
                assert patch["id"] == 6 and patch["draft_md"] == "合成人工编辑"
                self.row.update(patch)
                route.fulfill(json=[{"id": 6}])
                return
            if method == "POST" and path == RENDER:
                self.requests.append(request.post_data_json)
                route.fulfill(status=202, json={"jobId": "qa-current"})
                return
            if method == "GET" and (path in ("/", "/favicon.ico", VIDEO) or path.startswith("/assets/")):
                route.continue_()
                return
        self.unexpected.append((method, path))
        route.abort()


def check_rendering(page, base, workflow, media_file, touch):
    page.goto(f"{base}/#/workbench/6")
    editor = page.get_by_role("textbox", name="Markdown 编辑器")
    expect(editor).to_have_value("合成原稿")
    panel = page.get_by_role("region", name="渲染状态与成片")
    refresh = button(panel, "刷新渲染状态")
    retry = button(page, "重试 Remotion 渲染")
    expect(panel.get_by_role("alert")).to_contain_text("模拟上一任务失败")

    editor.fill("合成人工编辑")
    expect(retry).to_be_disabled()
    if touch:
        queue = page.get_by_role("complementary", name="待改稿列表")
        queue.get_by_role("combobox", name=re.compile("切换待改稿件")).select_option("7")
        next_item = button(queue, "打开")
    else:
        next_item = page.get_by_role("link", name=re.compile("第二份合成稿"))
    page.once("dialog", lambda dialog: dialog.dismiss())
    next_item.click()
    expect(editor).to_have_value("合成人工编辑")
    button(page, "保存草稿").click()
    expect(page.get_by_text("草稿已保存。", exact=True)).to_be_visible()
    expect(retry).to_be_enabled()
    retry.click()
    expect(panel.get_by_text("qa-current", exact=True)).to_be_visible()
    expect(panel.get_by_text("渲染状态 · 渲染中", exact=True)).to_be_visible()

    def read_status():
        with page.expect_response(lambda response: response.url.endswith(RECORDS + "/6")):
            refresh.click()
        expect(refresh).to_be_enabled()

    workflow.failed_reads = 1
    read_status()
    expect(panel.get_by_role("alert")).to_contain_text(re.compile("渲染状态读取失败.*刷新状态"))
    workflow.row.update(render_status="completed", video_url="/media/retired.mp4", render_error="")
    read_status()
    expect(panel.get_by_text("qa-current", exact=True)).to_be_visible()
    expect(panel.get_by_text("渲染状态 · 渲染中", exact=True)).to_be_visible()
    download = panel.get_by_role("link", name="下载视频")
    expect(download).to_have_count(0)

    workflow.row.update(render_job_id="qa-current", render_status="completed", video_url=VIDEO)
    read_status()
    expect(panel.get_by_text("渲染状态 · 已完成", exact=True)).to_be_visible()
    expect(download).to_have_attribute("href", VIDEO)
    video = panel.get_by_label("成片预览")
    expect(video).to_have_attribute("controls", "")
    video.evaluate("async node => { node.muted = true; await node.play() }")
    page.wait_for_function("""() => {
      const video = document.querySelector('video[aria-label="成片预览"]')
      return video?.currentTime > 0 && video.videoWidth === 160 &&
        video.getVideoPlaybackQuality().totalVideoFrames > 0
    }""")
    with page.expect_download() as event:
        download.click()
    assert event.value.path().read_bytes() == media_file.read_bytes()
    assert workflow.requests == [{"record_id": 6}]
    assert not workflow.unexpected, workflow.unexpected
    print(f"PASS {page.viewport_size['width']}px 已保存保护、失败恢复、旧任务隔离、当前 MP4 播放及下载字节一致", flush=True)

    workflow.row.update(render_job_id="qa-old", video_url="/media/retired.mp4")
    read_status()
    expect(download).to_have_attribute("href", VIDEO)
    workflow.row.update(render_job_id="qa-current", video_url=VIDEO)
    for state in ("completed", "rendering", "failed"):
        workflow.row.update(render_status=state, video_url="")
        read_status()
        expect(panel.get_by_text("渲染状态 · 已完成", exact=True)).to_be_visible(timeout=2500)
        expect(download).to_have_attribute("href", VIDEO, timeout=2500)
    print(f"PASS {page.viewport_size['width']}px 同任务迟到或重复回读保留已确认成片", flush=True)



def check_unknown_submission(page, base, workflow, from_drawer, transport):
    def open_entry(drawer):
        if drawer:
            page.goto(f"{base}/#/topics")
            card = page.get_by_role("article", name="合成渲染测试稿")
            button(card, "打开工作台").click()
            editor = page.get_by_role("dialog", name="内容精修工作台")
        else:
            page.goto(f"{base}/#/workbench/6")
            editor = page
        panel = editor.get_by_role("region", name="渲染状态与成片")
        expect(panel).to_be_visible()
        return editor, panel

    def reread(panel):
        refresh = button(panel, "刷新渲染状态")
        with page.expect_response(lambda response: response.url.endswith(RECORDS + "/6")):
            refresh.click()
        expect(refresh).to_be_enabled()

    editor, panel = open_entry(from_drawer)
    with page.expect_request(lambda request: request.url.endswith(RENDER) and request.method == "POST"):
        button(editor, "重试 Remotion 渲染").click()
    expect(editor.get_by_role("alert").filter(has_text=re.compile("504|未收到响应|提交结果未知"))).to_be_visible()
    assert workflow.requests == [{"record_id": 6}]

    editor, panel = open_entry(not from_drawer)
    reread(panel)
    submit = editor.get_by_role("button", name=re.compile(r"^(?:重试 Remotion 渲染|提交 Remotion 渲染|Remotion 渲染待核对)$"))
    expect(submit).to_be_visible()
    if not panel.get_by_text(re.compile("提交结果未知")).count():
        expect(submit).to_be_enabled()
        with page.expect_response(lambda response: response.url.endswith(RENDER) and response.request.method == "POST"):
            submit.click()
    assert workflow.requests == [{"record_id": 6}], f"{transport}: ambiguous acceptance allowed a second render POST"
    expect(submit).to_be_disabled()
    expect(panel.get_by_text(re.compile("提交结果未知"))).to_be_visible()

    page.reload()
    editor, panel = open_entry(not from_drawer)
    submit = editor.get_by_role("button", name=re.compile(r"^(?:重试 Remotion 渲染|提交 Remotion 渲染|Remotion 渲染待核对)$"))
    expect(submit).to_be_disabled()
    expect(panel.get_by_text(re.compile("提交结果未知"))).to_be_visible()

    workflow.failed_reads = 1
    reread(panel)
    expect(panel.get_by_role("alert")).to_contain_text("渲染状态读取失败")
    expect(submit).to_be_disabled()

    # A delayed previous-job result must not release this attempt.
    workflow.row.update(render_status="completed", video_url="/media/retired.mp4")
    reread(panel)
    expect(submit).to_be_disabled()
    expect(panel.get_by_role("link", name="下载视频")).to_have_count(0)
    assert workflow.requests == [{"record_id": 6}]

    # Even a different unobserved job ID is not proof that this submission ran.
    workflow.row.update(render_job_id="qa-even-older", render_status="failed", video_url="")
    reread(panel)
    expect(submit).to_be_disabled()
    expect(panel.get_by_text(re.compile("提交结果未知"))).to_be_visible()

    workflow.row.update(render_job_id="qa-current", render_status="rendering", video_url="")
    reread(panel)
    expect(panel.get_by_text("qa-current", exact=True)).to_be_visible()
    expect(submit).to_be_disabled()
    assert workflow.requests == [{"record_id": 6}]

    workflow.row.update(render_job_id="qa-old", render_status="failed")
    reread(panel)
    expect(submit).to_be_disabled()
    expect(panel.get_by_text("qa-current", exact=True)).to_be_visible()

    workflow.row.update(render_job_id="qa-current", render_status="failed", render_error="合成当前任务失败")
    reread(panel)
    expect(panel.get_by_role("alert")).to_contain_text("合成当前任务失败")
    expect(button(editor, "重试 Remotion 渲染")).to_be_enabled()
    assert workflow.requests == [{"record_id": 6}]
    with page.expect_response(lambda response: response.url.endswith(RENDER) and response.request.method == "POST"):
        button(editor, "重试 Remotion 渲染").click()
    assert workflow.requests == [{"record_id": 6}, {"record_id": 6}]
    assert not workflow.unexpected, workflow.unexpected
    print(f"PASS {transport} 跨入口仅一次 POST、旧终态与 GET 失败保持保护、确认当前任务失败后可重试", flush=True)


class UnknownWorkflow(Workflow):
    def __init__(self, base, transport):
        super().__init__(base)
        self.transport = transport
        self.legacy_requests = []

    def route(self, route):
        request = route.request
        url = urlsplit(request.url)
        same_origin = (url.scheme, url.netloc) == (self.base.scheme, self.base.netloc)
        if same_origin and request.method == "POST" and url.path == "/api/n8n/generate-video":
            self.legacy_requests.append(request.post_data_json)
            route.fulfill(status=504, json={"message": "synthetic legacy response timed out"})
            return
        if same_origin and request.method == "POST" and url.path == RENDER and not self.requests:
            self.requests.append(request.post_data_json)
            if self.transport == "504":
                route.fulfill(status=504, json={"message": "accepted upstream, response timed out"})
            else:
                route.abort("connectionreset")
            return
        super().route(route)


def check_legacy_submission(browser, base):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    workflow = UnknownWorkflow(base, "504")
    context.route("**/*", workflow.route)
    page = context.new_page()
    try:
        page.goto(f"{base}/#/workbench/6")
        legacy = button(page, "生成视频（旧版）")
        expect(legacy).to_be_hidden()
        button(page, "前往 Remotion 渲染").click()
        page.wait_for_function("document.activeElement?.classList.contains('wb-remotion')")
        page.get_by_text("旧版视频工具", exact=True).click()
        legacy.click()
        expect(page.get_by_role("alert").filter(has_text="视频任务提交结果未知")).to_be_visible()
        expect(legacy).to_be_disabled()
        page.reload()
        expect(legacy).to_be_hidden()
        page.get_by_text("旧版视频工具", exact=True).click()
        expect(legacy).to_be_disabled()
        expect(page.get_by_role("alert").filter(has_text="请先核对 n8n 执行记录")).to_be_visible()
        assert workflow.legacy_requests == [{"production_id": 6, "format": "16x9", "voice": "zh-CN-YunxiNeural"}]
        assert not workflow.requests and not workflow.unexpected
        print("PASS Remotion 主入口直达，旧版默认收起且 504 后重载不再 POST，旧请求合同保持一致", flush=True)
    finally:
        context.close()


def run_unknown_cases(browser, base):
    for from_drawer, transport in ((True, "504"), (False, "disconnect")):
        context = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
        workflow = UnknownWorkflow(base, transport)
        context.route("**/*", workflow.route)
        try:
            check_unknown_submission(context.new_page(), base, workflow, from_drawer, transport)
        finally:
            context.close()



class CrossOriginMedia(Workflow):
    media_origin = "https://render-media.example.invalid"
    inline = media_origin + "/inline.mp4"
    attachment = media_origin + "/attachment.mp4"

    def __init__(self, base, media_file):
        super().__init__(base)
        self.media_file = media_file
        self.row.update(render_job_id="qa-external", render_status="completed", video_url=self.inline)

    def route(self, route):
        if route.request.url in (self.inline, self.attachment):
            headers = {"Cache-Control": "no-store"}
            if route.request.url == self.attachment:
                headers["Content-Disposition"] = 'attachment; filename="contenthub-qa.mp4"'
            route.fulfill(path=self.media_file, content_type="video/mp4", headers=headers)
            return
        super().route(route)


def check_cross_origin_download(browser, base, media_file):
    context = browser.new_context(viewport={"width": 1440, "height": 900},
                                  accept_downloads=True, service_workers="block")
    workflow = CrossOriginMedia(base, media_file)
    context.route("**/*", workflow.route)
    downloads = []

    def record_download(download):
        downloads.append(download)

    context.on("page", lambda page: page.on("download", record_download))
    try:
        page = context.new_page()
        page.goto(f"{base}/#/workbench/6")
        panel = page.get_by_role("region", name="渲染状态与成片")
        link = panel.get_by_role("link", name=re.compile("下载视频|打开视频"))
        expect(link).to_have_attribute("href", workflow.inline)
        with context.expect_page() as popup:
            link.click()
        player = popup.value
        player.wait_for_url(workflow.inline)
        player.locator("video").wait_for()
        assert player.evaluate("document.contentType") == "video/mp4"
        assert not downloads, "inline cross-origin navigation unexpectedly saved a file"
        player.close()

        workflow.row["video_url"] = workflow.attachment
        button(panel, "刷新渲染状态").click()
        expect(link).to_have_attribute("href", workflow.attachment)
        link.click()
        for _ in range(30):
            if downloads:
                break
            page.wait_for_timeout(100)
        assert len(downloads) == 1, "cross-origin attachment did not generate a browser download event"
        assert downloads[0].suggested_filename == "contenthub-qa.mp4"
        assert downloads[0].path().read_bytes() == media_file.read_bytes()
        assert not workflow.requests and not workflow.unexpected, workflow.unexpected
        print("PASS 双 origin 区分跨域播放与 attachment 下载，下载文件字节一致", flush=True)

        expect(link).to_have_text("打开视频")
        assert link.get_attribute("download") is None
    finally:
        context.close()



class AttachmentContractMedia(CrossOriginMedia):
    attachment = CrossOriginMedia.attachment + "?fixture=qa%2Bdownload%3D&extra=1"


def check_independent_attachment(browser, base, media_file):
    context = browser.new_context(viewport={"width": 1440, "height": 900},
                                  accept_downloads=True, service_workers="block")
    workflow = AttachmentContractMedia(base, media_file)
    context.route("**/*", workflow.route)
    downloads = []

    def record_download(download):
        downloads.append(download)

    context.on("page", lambda page: page.on("download", record_download))
    try:
        page = context.new_page()
        page.goto(f"{base}/#/workbench/6")
        panel = page.get_by_role("region", name="渲染状态与成片")
        playback = panel.get_by_label("成片预览")
        open_video = panel.get_by_role("link", name="打开视频", exact=True)
        download = panel.get_by_role("link", name="下载视频", exact=True)

        def reread():
            refresh = button(panel, "刷新渲染状态")
            with page.expect_response(lambda response: response.url.endswith(RECORDS + "/6")):
                refresh.click()
            expect(refresh).to_be_enabled()

        expect(playback).to_have_attribute("src", workflow.inline)
        expect(open_video).to_have_attribute("href", workflow.inline)
        expect(download).to_have_count(0)

        workflow.row.update(video_download_url=workflow.attachment,
                            video_download_expires_at="2099-01-01T00:00:00Z")
        reread()
        expect(download).to_have_attribute("href", workflow.attachment)
        expect(playback).to_have_attribute("src", workflow.inline)
        expect(open_video).to_have_attribute("href", workflow.inline)
        download.click()
        for _ in range(50):
            if downloads:
                break
            page.wait_for_timeout(100)
        assert len(downloads) == 1
        assert downloads[0].suggested_filename == "contenthub-qa.mp4"
        downloaded = hashlib.sha256(downloads[0].path().read_bytes()).hexdigest()
        assert downloaded == hashlib.sha256(media_file.read_bytes()).hexdigest()
        print("PASS 独立附件触发保存且 SHA-256 一致，播放地址与签名原样保留", flush=True)

        workflow.row["video_download_expires_at"] = "2000-01-01T00:00:00Z"
        reread()
        expect(download).to_have_count(0)
        expect(open_video).to_have_attribute("href", workflow.inline)
        expect(panel.get_by_text(re.compile("下载链接已过期"))).to_be_visible()
        workflow.row.pop("video_download_url")
        workflow.row.pop("video_download_expires_at")
        reread()
        expect(download).to_have_count(0)
        expect(open_video).to_have_attribute("href", workflow.inline)

        workflow.row["video_download_url"] = workflow.attachment
        reread()
        expect(download).to_have_attribute("href", workflow.attachment)
        with page.expect_response(lambda response: response.url.endswith(RENDER) and response.request.method == "POST"):
            button(page, "提交 Remotion 渲染").click()
        expect(panel.get_by_text("qa-current", exact=True)).to_be_visible()
        expect(download).to_have_count(0)
        reread()
        expect(download).to_have_count(0)
        new_link = workflow.attachment + "&job=qa-current"
        workflow.row.update(render_job_id="qa-current", video_download_url=new_link)
        reread()
        expect(download).to_have_attribute("href", new_link)
        expect(playback).to_have_attribute("src", workflow.inline)
        assert workflow.requests == [{"record_id": 6}] and not workflow.unexpected
        print("PASS 缺少或过期回退播放，新任务不会展示旧任务附件链接", flush=True)
    finally:
        context.close()



class LegacyR2Media(CrossOriginMedia):
    media_origin = "https://fixture.00000000000000000000000000000000.r2.cloudflarestorage.com"

    def __init__(self, base, media_file):
        super().__init__(base, media_file)
        self.valid = self.sign("current")
        self.revoked = self.sign("revoked")
        self.inline_signed = self.sign("inline").replace("=attachment%3B", "=inline%3B")
        self.expired = self.sign("expired", age=7200)
        self.requests_for_attachments = []

    def sign(self, name, age=5):
        moment = datetime.now(timezone.utc) - timedelta(seconds=age)
        return (
            f"{self.media_origin}/{name}.mp4"
            "?response-content-disposition=attachment%3B%20filename%3Dcontenthub-fixture.mp4"
            "&X-Amz-Algorithm=AWS4-HMAC-SHA256"
            f"&X-Amz-Credential=EXAMPLE%2F{moment:%Y%m%d}%2Fauto%2Fs3%2Faws4_request"
            f"&X-Amz-Date={moment:%Y%m%dT%H%M%SZ}&X-Amz-Expires=3600"
            f"&X-Amz-Signature={'a' * 64}&X-Amz-SignedHeaders=host&x-id=GetObject"
        )

    def route(self, route):
        request = route.request
        if request.url in (self.valid, self.revoked):
            assert request.method == "GET"
            assert "referer" not in request.headers
            self.requests_for_attachments.append(request.url)
            if request.url == self.revoked:
                route.fulfill(status=403, body="<html><title>模拟签名已撤销</title></html>", content_type="text/html")
            else:
                route.fulfill(
                    path=self.media_file, content_type="video/mp4",
                    headers={"Content-Disposition": 'attachment; filename="contenthub-fixture.mp4"'},
                )
            return
        super().route(route)


def check_legacy_r2_attachment(browser, base, media_file):
    context = browser.new_context(accept_downloads=True, service_workers="block")
    workflow = LegacyR2Media(base, media_file)
    context.route("**/*", workflow.route)
    try:
        page = context.new_page()
        workbench = f"{base}/#/workbench/6"
        page.goto(workbench)
        panel = page.get_by_role("region", name="渲染状态与成片")
        download = panel.get_by_role("link", name="下载视频", exact=True)
        playback = panel.get_by_role("link", name="打开视频", exact=True)

        def reread(media):
            workflow.row["video_url"] = media
            with page.expect_response(lambda r: r.url.endswith(RECORDS + "/6")):
                button(panel, "刷新渲染状态").click()

        for url in (workflow.inline_signed, workflow.expired):
            reread(url)
            expect(playback).to_have_attribute("href", url)
            expect(download).to_have_count(0)
        assert not workflow.requests_for_attachments

        reread(workflow.valid)
        expect(download).to_have_attribute("href", workflow.valid)
        draft = page.get_by_role("textbox", name="Markdown 编辑器")
        draft.fill("合成未保存正文")
        expect(page.get_by_text("未保存", exact=True)).to_be_visible()
        dialogs = []

        def capture_dialog(dialog):
            dialogs.append(dialog.type)
            dialog.dismiss()

        page.on("dialog", capture_dialog)
        with page.expect_download() as click:
            download.click()
        assert click.value.suggested_filename == "contenthub-fixture.mp4"
        assert hashlib.sha256(click.value.path().read_bytes()).digest() == hashlib.sha256(media_file.read_bytes()).digest()
        assert context.pages == [page] and page.url == workbench and not dialogs
        expect(draft).to_have_value("合成未保存正文")

        reread(workflow.revoked)
        expect(download).to_have_attribute("href", workflow.revoked)
        with page.expect_response(lambda r: r.url == workflow.revoked and r.status == 403):
            download.click()
        assert context.pages == [page] and page.url == workbench and not dialogs
        expect(draft).to_have_value("合成未保存正文")
        assert workflow.requests_for_attachments == [workflow.valid, workflow.revoked]
        assert not workflow.requests and not workflow.unexpected
        print("PASS R2 旧字段原样 GET，触发原生下载且 SHA-256 一致；失效响应保持当前页和未保存正文", flush=True)
    finally:
        context.close()



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", required=True, type=Path)
    args = parser.parse_args()
    media_file = args.dist / VIDEO.lstrip("/")
    assert media_file.is_file()
    handler = partial(QuietStaticHandler, directory=str(args.dist.resolve()))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with sync_playwright() as playwright, playwright.chromium.launch(chromium_sandbox=True) as browser:
                check_legacy_r2_attachment(browser, base, media_file)
                check_independent_attachment(browser, base, media_file)
                check_cross_origin_download(browser, base, media_file)
                run_unknown_cases(browser, base)
                check_legacy_submission(browser, base)
                for width, height in ((1440, 900), (390, 844)):
                    touch = width < 768
                    context = browser.new_context(
                        viewport={"width": width, "height": height}, has_touch=touch,
                        accept_downloads=True, service_workers="block",
                    )
                    workflow = Workflow(base)
                    context.route("**/*", workflow.route)
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    try:
                        check_rendering(page, base, workflow, media_file, touch)
                        assert not errors, errors
                    finally:
                        context.close()
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
