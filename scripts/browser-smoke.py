"""Run a local editor smoke test against an already running development server."""

import base64
import json
import os
import time
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright


BASE = os.environ.get("RUNES_BASE_URL", "http://localhost:3000")
CHROMIUM = os.environ.get("RUNES_CHROMIUM", "/usr/bin/chromium")
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
SOURCE = (
    "\\documentclass{article}\n"
    "\\begin{document}\n"
    "This sentence is repeated.\n"
    "This sentence is repeated.\n"
    "\\end{document}"
)
SECOND_SOURCE = SOURCE.replace("This sentence is repeated.", "Another document has prose.")


def source_value(page):
    return page.evaluate("window.monaco.editor.getModels()[0].getValue()")


def select_second_line(page):
    page.locator(".monaco-editor").first.click()
    page.keyboard.press("Control+Home")
    for _ in range(3):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Shift+End")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROMIUM, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    created_slug = None
    second_slug = None
    md_slug = None
    navigation_slug = None
    try:
        page.set_viewport_size({"width": 390, "height": 800})
        page.goto(BASE, wait_until="domcontentloaded")
        page.get_by_role("link", name="Start writing").first.click()
        page.wait_for_url("**/signin**", timeout=15000)
        expect(page.get_by_role("heading", name="Sign in to Runes AI")).to_be_visible()

        page.goto(f"{BASE}/api/dev-login", wait_until="domcontentloaded")
        assert urlparse(page.url).path == "/document", page.url
        page.get_by_role("button", name="New document").click()
        dialog = page.get_by_role("dialog", name="Create document")
        expect(dialog).to_be_visible()
        bounds = dialog.bounding_box()
        assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 390, bounds
        page.set_viewport_size({"width": 390, "height": 400})
        bounds = dialog.bounding_box()
        create_bounds = dialog.get_by_role("button", name="Create", exact=True).bounding_box()
        assert bounds and bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 400, bounds
        assert create_bounds and create_bounds["y"] + create_bounds["height"] <= 400, create_bounds
        page.set_viewport_size({"width": 390, "height": 800})
        dialog.get_by_role("textbox", name="Title", exact=True).fill(f"Browser Nav {time.time_ns() % 10**12}")
        dialog.get_by_role("radio", name="LaTeX").check()
        dialog.get_by_role("button", name="Create", exact=True).click()
        page.wait_for_url("**/document/*", timeout=15000)
        navigation_slug = urlparse(page.url).path.split("/")[-1]
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        assert page.evaluate("window.monaco.editor.getModels()[0].getLanguageId()") == "latex"
        deleted = context.request.delete(f"{BASE}/api/document/{navigation_slug}")
        assert deleted.status == 200, (deleted.status, deleted.text())
        navigation_slug = None
        page.set_viewport_size({"width": 1280, "height": 800})

        title = f"Smoke {time.time_ns() % 10**16}"
        created = context.request.post(f"{BASE}/api/document", data={"title": title, "content": SOURCE})
        assert created.status == 201, (created.status, created.text())
        created_slug = created.json()["slug"]
        second = context.request.post(f"{BASE}/api/document", data={"title": f"Second {time.time_ns() % 10**16}", "content": SECOND_SOURCE})
        assert second.status == 201, (second.status, second.text())
        second_slug = second.json()["slug"]

        page.route("**/api/ai/paraphrase", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"replacementText": "The second sentence changed.", "noop": False}),
        ))
        page.route("**/api/ai/complete", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"insertion": " Further evidence follows."}),
        ))
        page.goto(f"{BASE}/document/{created_slug}", wait_until="domcontentloaded")
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        assert source_value(page) == SOURCE
        expect(page.get_by_role("button", name="Paraphrase", exact=True)).to_be_disabled()

        page.evaluate("""() => {
          const original = window.fetch;
          window.fetch = (input, init) => {
            if (String(input).includes('/api/ai/paraphrase')) {
              return new Promise(resolve => {
                window.__releaseParaphrase = () => resolve(new Response(
                  JSON.stringify({ replacementText: 'A delayed replacement.', noop: false }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } }
                ));
              });
            }
            return original(input, init);
          };
          window.__restoreFetch = () => { window.fetch = original; };
        }""")
        select_second_line(page)
        expect(page.get_by_role("button", name="Paraphrase", exact=True)).to_be_enabled()
        page.get_by_role("button", name="Paraphrase", exact=True).click()
        page.wait_for_function("typeof window.__releaseParaphrase === 'function'")
        select_second_line(page)
        page.keyboard.type("Changed while waiting.")
        page.evaluate("window.__releaseParaphrase(); window.__restoreFetch()")
        expect(page.locator("span", has_text="Response discarded").first).to_be_visible(timeout=5000)
        assert page.get_by_role("region", name="AI proposal review").count() == 0
        for _ in range(30):
            if source_value(page) == SOURCE:
                break
            page.keyboard.press("Control+z")
        assert source_value(page) == SOURCE

        select_second_line(page)
        page.get_by_role("button", name="Paraphrase", exact=True).click()
        page.get_by_role("region", name="AI proposal review").wait_for(timeout=10000)
        assert source_value(page) == SOURCE
        page.get_by_role("button", name="Reject proposal").click()
        assert source_value(page) == SOURCE

        select_second_line(page)
        page.get_by_role("button", name="Paraphrase", exact=True).click()
        page.get_by_role("region", name="AI proposal review").wait_for(timeout=10000)
        select_second_line(page)
        page.keyboard.type("Changed while reviewing.")
        assert "Changed while reviewing." in source_value(page)
        expect(page.get_by_role("button", name="Accept proposal")).to_be_disabled(timeout=3000)
        for _ in range(30):
            if source_value(page) == SOURCE:
                break
            page.keyboard.press("Control+z")
        assert source_value(page) == SOURCE, repr(source_value(page))
        page.get_by_role("button", name="Reject proposal").click()

        select_second_line(page)
        page.get_by_role("button", name="Paraphrase", exact=True).click()
        page.get_by_role("button", name="Accept proposal").click()
        changed = SOURCE.replace("This sentence is repeated.\n\\end", "The second sentence changed.\n\\end")
        assert source_value(page) == changed, repr(source_value(page))

        page.locator(".monaco-editor").first.click()
        page.keyboard.press("Control+z")
        assert source_value(page) == SOURCE
        page.keyboard.press("Control+Shift+z")
        assert source_value(page) == changed

        page.keyboard.press("Control+s")
        page.wait_for_timeout(500)
        saved = context.request.get(f"{BASE}/api/document/{created_slug}")
        assert saved.json()["document"]["content"] == changed
        page.reload(wait_until="domcontentloaded")
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        assert source_value(page) == changed
        page.locator(".monaco-editor").first.click()
        page.keyboard.press("Control+Home")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("End")
        page.keyboard.type(" Additional")
        page.wait_for_timeout(1300)
        page.keyboard.press("Tab")
        assert "Additional Further evidence follows." in source_value(page), repr(source_value(page))

        # 640px = Tailwind `sm`, the breakpoint the toolbar labels collapse at.
        page.set_viewport_size({"width": 640, "height": 800})
        controls = ["Paraphrase", "Compile", "AI complete"]
        for label in controls:
            locator = page.get_by_text(label, exact=True).first
            box = locator.bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= 640, (label, box)

        page.set_viewport_size({"width": 1280, "height": 800})
        with page.expect_response(lambda response: response.url.endswith(f"/api/document/{created_slug}") and response.request.method == "POST", timeout=20000) as queued:
            page.get_by_role("button", name="Compile", exact=True).click()
        queue_response = queued.value
        assert queue_response.status == 202, (queue_response.status, queue_response.text())
        job_id = queue_response.json()["jobId"]
        for _ in range(60):
            status_response = context.request.get(f"{BASE}/api/job/{job_id}")
            assert status_response.status == 200
            status = status_response.json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(2)
        assert status["status"] == "completed", status
        pdf = context.request.get(f"{BASE}/api/pdf/{job_id}")
        assert pdf.status == 200 and pdf.body().startswith(b"%PDF"), (pdf.status, pdf.text()[:300])
        page.locator('iframe[title="PDF Preview"]').wait_for(timeout=20000)
        with page.expect_download() as download:
            page.locator('button[title="Download PDF"]').click()
        assert download.value.suggested_filename.endswith('.pdf')
        page.locator(".monaco-editor").first.click()
        page.keyboard.press("Control+Home")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("End")
        page.keyboard.type(" Updated")
        expect(page.get_by_text("PDF is older than the current source", exact=False)).to_be_visible(timeout=5000)
        page.evaluate("""() => {
          const original = window.fetch;
          window.fetch = (input, init) => {
            if (String(input).includes('/api/ai/paraphrase')) return new Promise(() => {});
            return original(input, init);
          };
        }""")
        select_second_line(page)
        page.get_by_role("button", name="Paraphrase", exact=True).click()
        expect(page.get_by_text("AI working...", exact=True)).to_be_visible(timeout=3000)
        page.goto(f"{BASE}/document/{second_slug}", wait_until="domcontentloaded")
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        assert source_value(page) == SECOND_SOURCE
        assert page.get_by_role("region", name="AI proposal review").count() == 0

        # ---- Markdown document flow ----
        md_title = f"Smoke MD {time.time_ns() % 10**16}"
        md_created = context.request.post(
            f"{BASE}/api/document",
            data={"title": md_title, "format": "MARKDOWN"},
        )
        assert md_created.status == 201, (md_created.status, md_created.text())
        md_slug = md_created.json()["slug"]

        upload = context.request.post(
            f"{BASE}/api/document/{md_slug}/assets",
            multipart={"file": {"name": "logo.png", "mimeType": "image/png", "buffer": PNG_1PX}, "path": "images/logo.png"},
        )
        assert upload.status == 201, (upload.status, upload.text())
        asset_url = upload.json()["asset"]["url"]
        assert asset_url == f"/api/document/{md_slug}/assets/images/logo.png", asset_url
        served = context.request.get(f"{BASE}{asset_url}")
        assert served.status == 200 and served.headers.get("content-type") == "image/png", served.status

        md_source = (
            f"# {md_title}\n\n"
            "Prose with `inline code` and [a link](https://example.com) plus math $E = mc^2$.\n\n"
            f"![Logo]({asset_url})\n\n"
            "![Remote](https://evil.example.com/x.png)\n\n"
            "## Table section\n\n"
            "| a | b |\n| - | - |\n| 1 | 2 |\n"
        )
        page.goto(f"{BASE}/document/{md_slug}", wait_until="domcontentloaded")
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        assert page.evaluate("window.monaco.editor.getModels()[0].getLanguageId()") == "markdown"
        assert "Start writing here" in source_value(page)

        preview = page.locator(".markdown-preview")
        preview.wait_for(timeout=20000)
        assert page.get_by_role("heading", name=md_title).count() >= 1
        assert "Start writing here" in preview.inner_text()
        assert "code blocks are supported" in preview.inner_text()

        page.locator(".monaco-editor").first.click()
        page.evaluate("text => window.monaco.editor.getModels()[0].setValue(text)", md_source)
        page.keyboard.press("Control+s")
        page.wait_for_timeout(800)
        assert page.evaluate("window.monaco.editor.getModels()[0].getValue()") == md_source
        page.wait_for_timeout(600)
        assert page.locator(f'.markdown-preview img[src="{asset_url}"]').count() == 1
        assert page.get_by_role("heading", name="Table section").count() >= 1

        page.get_by_role("button", name="Reading", exact=True).click()
        preview.wait_for(timeout=10000)

        def md_compile_job():
            with page.expect_response(lambda response: response.url.endswith(f"/api/document/{md_slug}") and response.request.method == "POST", timeout=20000) as queued:
                page.get_by_role("button", name="Compile", exact=True).click()
            queue = queued.value
            assert queue.status == 202, (queue.status, queue.text())
            job = queue.json()["jobId"]
            status = None
            for _ in range(90):
                status_response = context.request.get(f"{BASE}/api/job/{job}")
                assert status_response.status == 200
                status = status_response.json()
                if status["status"] in ("completed", "failed"):
                    break
                time.sleep(2)
            return job, status

        # Remote images are refused by the compiler with an actionable error.
        rejected_job, rejected = md_compile_job()
        assert rejected["status"] == "failed", rejected
        assert "Remote images are not supported" in rejected["result"]["error"], rejected
        error_dialog = page.get_by_role("dialog", name="Error")
        expect(error_dialog).to_contain_text("Remote images are not supported", timeout=5000)
        error_dialog.get_by_role("button", name="Close", exact=True).last.click()
        expect(error_dialog).to_have_count(0, timeout=5000)
        page.wait_for_timeout(300)

        page.get_by_role("button", name="Source", exact=True).click()
        page.locator(".monaco-editor").first.wait_for(timeout=10000)
        md_compilable = md_source.replace("![Remote](https://evil.example.com/x.png)\n\n", "")
        page.evaluate("text => window.monaco.editor.getModels()[0].setValue(text)", md_compilable)
        page.keyboard.press("Control+s")
        page.wait_for_timeout(800)

        with page.expect_response(lambda response: response.url.endswith(f"/api/document/{md_slug}") and response.request.method == "POST", timeout=20000) as md_queued:
            page.get_by_role("button", name="Compile", exact=True).click()
        md_queue = md_queued.value
        assert md_queue.status == 202, (md_queue.status, md_queue.text())
        md_job = md_queue.json()["jobId"]
        for _ in range(90):
            md_status_response = context.request.get(f"{BASE}/api/job/{md_job}")
            assert md_status_response.status == 200
            md_status = md_status_response.json()
            if md_status["status"] in ("completed", "failed"):
                break
            time.sleep(2)
        assert md_status["status"] == "completed", md_status
        md_pdf = context.request.get(f"{BASE}/api/pdf/{md_job}")
        assert md_pdf.status == 200 and md_pdf.body().startswith(b"%PDF"), (md_pdf.status, md_pdf.text()[:300])
        assert b"/Subtype" in md_pdf.body() and b"/Image" in md_pdf.body(), "uploaded image XObject missing from compiled PDF"
        page.get_by_role("button", name="Reading", exact=True).click()
        page.get_by_role("tab", name="Reading preview").wait_for(timeout=10000)
        page.get_by_role("tab", name="PDF").click()
        page.locator('iframe[title="PDF Preview"]').wait_for(timeout=20000)

        with page.expect_download() as md_download:
            page.locator(f'button[title="Download {md_slug}.md file"]').click()
        assert md_download.value.suggested_filename == f"{md_slug}.md", md_download.value.suggested_filename

        page.goto(f"{BASE}/document", wait_until="domcontentloaded")
        expect(page.locator("span", has_text="Markdown .md").first).to_be_visible(timeout=10000)
        expect(page.get_by_role("group", name="Filter documents by format")).to_be_visible()
        assert page.get_by_text(md_title, exact=False).count() >= 1

        # ---- Editor upload flow: insert an image via the toolbar button ----
        png_path = "/tmp/logo-ui.png"
        with open(png_path, "wb") as handle:
            handle.write(PNG_1PX)
        page.goto(f"{BASE}/document/{md_slug}", wait_until="domcontentloaded")
        page.locator(".monaco-editor").first.wait_for(timeout=20000)
        page.get_by_role("button", name="Source", exact=True).click()
        insert_button = page.get_by_role("button", name="Insert image", exact=True)
        expect(insert_button).to_be_visible()
        page.get_by_label("Choose image to insert").set_input_files(png_path)
        expect(page.get_by_role("status").filter(has_text="Inserted logo-ui.png")).to_be_visible(timeout=15000)
        value_after_upload = source_value(page)
        assert "![logo-ui](" in value_after_upload and f"/api/document/{md_slug}/assets/logo-ui.png" in value_after_upload, value_after_upload[-200:]
        page.keyboard.press("Control+s")
        page.wait_for_timeout(800)
        ui_pdf_ok = None
        with page.expect_response(lambda response: response.url.endswith(f"/api/document/{md_slug}") and response.request.method == "POST", timeout=20000) as ui_queued:
            page.get_by_role("button", name="Compile", exact=True).click()
        ui_job = ui_queued.value.json()["jobId"]
        for _ in range(90):
            ui_status = context.request.get(f"{BASE}/api/job/{ui_job}").json()
            if ui_status["status"] in ("completed", "failed"):
                break
            time.sleep(2)
        assert ui_status["status"] == "completed", ui_status
        ui_pdf = context.request.get(f"{BASE}/api/pdf/{ui_job}").body()
        assert b"/Image" in ui_pdf, "uploaded image missing from PDF objects"
        ui_pdf_ok = True
        os.unlink(png_path)
        print("browser smoke passed: mobile sign-in and document creation, latex edit/review/compile, markdown asset API and editor upload UI, reading preview, remote-image block, markdown PDF with embedded images, source download, dashboard badge/filter")
    finally:
        if navigation_slug:
            context.request.delete(f"{BASE}/api/document/{navigation_slug}")
        if created_slug:
            context.request.delete(f"{BASE}/api/document/{created_slug}")
        if second_slug:
            context.request.delete(f"{BASE}/api/document/{second_slug}")
        if md_slug:
            context.request.delete(f"{BASE}/api/document/{md_slug}")
        browser.close()
