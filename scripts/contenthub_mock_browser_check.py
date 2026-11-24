"""ContentHub dcdb7c5 的本地 Mock 浏览器回归。

在已有 Playwright 与 Chromium 的环境中运行。先从该提交构建 Mock dist，
再从仓库根目录运行 python contenthub_mock_browser_check.py --dist dist。
可用 --chromium 指定已安装 Chromium 的可执行文件，或使用 Playwright 已下载的版本。
脚本使用独立浏览器上下文和临时本机回环服务器，屏蔽业务 API 与外部请求。
"""

import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


TOPIC = "【模拟】用分组图比较三个城市的通勤时间"
MODE = "Mock · 离线演示"
TABS = ("图文正文", "视频口播稿", "Remotion 渲染数据", "原始信源与大纲")


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def button(root, name):
    return root.get_by_role("button", name=name, exact=True)


def go(page, base, route, heading):
    page.goto(f"{base}/#/{route}")
    expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
    expect(page.get_by_text(MODE, exact=True).first).to_be_attached()


def open_tab(editor, name, touch=False):
    tab = editor.get_by_role("tablist", name="精修内容").get_by_role("tab", name=name, exact=True)
    if touch:
        tab.tap()
    else:
        tab.click()
    expect(tab).to_have_attribute("aria-selected", "true")
    panel = editor.get_by_role("tabpanel", name=name, exact=True)
    expect(panel).to_be_visible()
    return panel


def topics_and_desk(page, base):
    go(page, base, "topics", "选题看板")
    expect(page.get_by_text("当前总选题数：7 条", exact=True)).to_be_visible()
    page.get_by_role("searchbox", name="标题/关键词").fill("三个城市的通勤时间")
    button(page, "搜索").click()
    expect(page.get_by_role("article")).to_have_count(1)
    card = page.get_by_role("article", name=TOPIC, exact=True)
    button(card, "生成初稿").click()
    expect(card.get_by_text("初稿已生成，可进入工作台审核", exact=True)).to_be_visible(timeout=15000)

    button(card, "打开工作台").click()
    desk = page.get_by_role("dialog", name="内容精修工作台")
    expect(desk.get_by_role("textbox", name="图文正文", exact=True)).to_have_value(re.compile(TOPIC))
    for name in TABS:
        open_tab(desk, name)
    expect(desk.get_by_role("heading", name="事实核查备注")).to_be_visible()

    open_tab(desk, "图文正文").get_by_role("textbox", name="图文正文", exact=True).fill("模拟人工精修正文")
    expect(desk.get_by_text("未保存", exact=True)).to_be_visible()
    page.once("dialog", lambda dialog: dialog.dismiss())
    button(desk, "关闭工作台").click()
    expect(desk).to_be_visible()

    desk.get_by_role("textbox", name="修改侧重点（可选）").fill("保留口径")
    button(desk, "AI 挑刺去味").click()
    expect(desk.get_by_text("AI 改稿已写入草稿，请人工核对", exact=True)).to_be_visible()
    expect(desk.get_by_role("textbox", name="图文正文", exact=True)).to_have_value(re.compile("【模拟精修】保留口径"))

    json_editor = open_tab(desk, "Remotion 渲染数据").get_by_role("textbox", name="Remotion JSON")
    json_editor.fill('{"scenes": [')
    expect(json_editor).to_have_attribute("aria-invalid", "true")
    expect(button(desk, "人工复核通过并定稿")).to_be_disabled()
    expect(button(desk, "提交 Remotion 渲染")).to_be_disabled()
    json_editor.fill("")
    expect(desk.get_by_text("留空时由 WF4 自动生成分镜。", exact=True)).to_be_visible()
    button(desk, "保存草稿").click()
    expect(desk.get_by_text("草稿已保存", exact=True)).to_be_visible()
    expect(button(desk, "人工复核通过并定稿")).to_be_enabled()
    button(desk, "提交 Remotion 渲染").click()
    results = desk.get_by_role("region", name="渲染状态与成片")
    expect(results.get_by_text("渲染状态 · 渲染中", exact=True)).to_be_visible()
    expect(results.get_by_text("渲染状态 · 已完成", exact=True)).to_be_visible(timeout=20000)
    expect(results.get_by_text("渲染已完成，暂未提供可用的视频地址。", exact=True)).to_be_visible()
    expect(results.get_by_role("link", name="下载视频")).to_have_count(0)
    button(results, "刷新渲染状态").click()
    expect(button(results, "刷新渲染状态")).to_be_enabled()
    button(desk, "关闭工作台").click()
    expect(desk).to_be_hidden()
    print("PASS 选题搜索和总数、初稿回写、抽屉四 Tab、未保存保护、AI 回填、JSON 门禁与渲染轮询", flush=True)


def workbench(page, base):
    go(page, base, "workbench", "改稿台")
    expect(page.get_by_role("complementary", name="待改稿列表")).to_be_visible()
    expect(page.get_by_text(re.compile("选题记录 #6"))).to_be_visible()
    expect(page.get_by_role("textbox", name="Markdown 编辑器")).to_have_value(re.compile("模拟人工精修正文"))
    for name in TABS:
        open_tab(page, name)
    tab = page.get_by_role("tablist", name="精修内容").get_by_role("tab", name=TABS[-1], exact=True)
    tab.press("Home")
    expect(page.get_by_role("tabpanel", name=TABS[0], exact=True)).to_be_visible()
    print("PASS 独立改稿台直接进入、队列默认选中、同会话保存读回、四 Tab 与键盘切换", flush=True)


def narrow_sources_and_analytics(page, base):
    go(page, base, "topics", "选题看板")
    button(page, "打开导航").tap()
    page.get_by_role("dialog").get_by_role("link", name="改稿台", exact=True).tap()
    expect(page.get_by_role("heading", name="改稿台", exact=True)).to_be_visible()
    queue = page.get_by_role("complementary", name="待改稿列表")
    queue.get_by_role("combobox", name=re.compile("切换待改稿件")).select_option("3")
    button(queue, "打开").tap()
    expect(page.get_by_text(re.compile("选题记录 #3"))).to_be_visible()
    for name in TABS:
        open_tab(page, name, touch=True)
    print("PASS 手机改稿台选稿与四 Tab 触控", flush=True)
    button(page, "打开导航").tap()
    page.get_by_role("dialog").get_by_role("link", name="信源管理", exact=True).tap()
    expect(page.get_by_role("heading", name="信源管理", exact=True)).to_be_visible()
    expect(page.get_by_role("dialog")).to_have_count(0)
    filters = page.get_by_role("group", name="按分组筛选")
    button(filters, "生产池").tap()
    source = page.get_by_role("switch", name="启用 模拟·零售数据观察", exact=True)
    expect(source).to_have_count(1)
    expect(source).to_have_attribute("aria-checked", "true")
    source.tap()
    expect(source).to_have_attribute("aria-checked", "false")

    button(page, "新增信源").tap()
    form = page.get_by_role("dialog", name="新增 RSS 信源")
    form.get_by_label("信源名称").fill("模拟·浏览器验收信源")
    form.get_by_label("RSS 链接").fill("https://rss.example.invalid/browser-check.xml")
    form.get_by_label("赛道").fill("商业数据")
    button(form, "保存信源").tap()
    expect(page.get_by_role("heading", name="模拟·浏览器验收信源", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth")
    print("PASS 手机导航抽屉、RSS 分组、唯一可触达开关、新增及无页面横向溢出", flush=True)

    go(page, base, "analytics", "运营数据")
    expect(page.get_by_role("heading", name="阅读量趋势", exact=True)).to_be_visible()
    button(page, "近 30 天").tap()
    expect(button(page, "近 30 天")).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_role("heading", name="雷达机会", exact=True)).to_be_visible()
    expect(page.get_by_text(re.compile("如何按使用频率、租期和押金"))).to_be_visible()
    expect(page.get_by_text(re.compile("整理因比价耗时而放弃购买"))).to_have_count(0)
    button(page, "录入运营数据").tap()
    form = page.get_by_role("dialog", name="录入运营数据")
    form.get_by_label("已发布内容").select_option("5")
    form.get_by_label("平台", exact=True).select_option("B站")
    for label, value in {
        "新增展现量": "100", "新增阅读量": "20", "平台 CTR（%）": "4.5",
        "平台完读率（%）": "60", "单日收益（元）": "1.25",
    }.items():
        form.get_by_label(label, exact=True).fill(value)
    button(form, "保存数据").tap()
    expect(page.get_by_text("运营数据已保存。", exact=True)).to_be_visible()
    print("PASS 手机运营数据、30 天筛选、雷达分数边界、合成运营数据保存", flush=True)


def run_browser(base, chromium_path):
    base_url = urlsplit(base)
    with sync_playwright() as playwright:
        launch = {"chromium_sandbox": True}
        if chromium_path:
            launch["executable_path"] = chromium_path
        with playwright.chromium.launch(**launch) as browser:
            print(f"Chromium {browser.version}", flush=True)
            for width, height, test in [
                (1440, 900, lambda page: (topics_and_desk(page, base), workbench(page, base))),
                (390, 844, lambda page: narrow_sources_and_analytics(page, base)),
            ]:
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    has_touch=width < 768,
                    service_workers="block",
                )
                errors = []
                blocked = []

                def restrict(route):
                    request = route.request
                    url = urlsplit(request.url)
                    is_local = (url.scheme, url.netloc) == (base_url.scheme, base_url.netloc)
                    if request.method == "GET" and is_local and not url.path.startswith("/api/"):
                        route.continue_()
                    else:
                        blocked.append((request.method, request.resource_type))
                        route.abort()

                context.route("**/*", restrict)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    test(page)
                    assert not errors, errors
                    assert not blocked, blocked
                finally:
                    context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=Path("dist"))
    parser.add_argument("--chromium", help="已安装 Chromium 的可执行文件路径")
    args = parser.parse_args()
    dist = args.dist.resolve()
    if not (dist / "index.html").is_file():
        parser.error("找不到 dist/index.html。请先用 VITE_USE_MOCK=true 构建。")

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietStaticHandler, directory=str(dist))) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run_browser(f"http://127.0.0.1:{server.server_port}", args.chromium)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
