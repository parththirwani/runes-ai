"""Run a local editor smoke test against an already running development server."""

import json
import os
import time
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright


BASE = os.environ.get("RUNES_BASE_URL", "http://localhost:3000")
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
    browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    created_slug = None
    second_slug = None
    try:
        page.goto(f"{BASE}/api/dev-login", wait_until="domcontentloaded")
        assert urlparse(page.url).path == "/document", page.url

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
        expect(page.get_by_text("Response discarded", exact=False)).to_be_visible(timeout=5000)
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

        page.set_viewport_size({"width": 600, "height": 800})
        controls = ["Paraphrase", "Compile", "AI complete"]
        for label in controls:
            locator = page.get_by_text(label, exact=True).first
            box = locator.bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= 600, (label, box)

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
        print("browser smoke passed: edit, review, stale results, document switch, completion, responsive controls, live compile, PDF preview, download, stale PDF")
    finally:
        if created_slug:
            context.request.delete(f"{BASE}/api/document/{created_slug}")
        if second_slug:
            context.request.delete(f"{BASE}/api/document/{second_slug}")
        browser.close()
