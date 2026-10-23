import json
import os
import time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('RUNES_BASE_URL', 'http://127.0.0.1:3000')
CHROMIUM = os.environ.get('RUNES_CHROMIUM', '/usr/bin/chromium')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()
    slug = None
    latex_slug = None
    try:
        page.goto(f'{BASE}/api/dev-login', wait_until='domcontentloaded')
        assert page.url.endswith('/document'), page.url
        created = context.request.post(f'{BASE}/api/document', data={'title': f'MD smoke {time.time_ns() % 10**12}', 'format': 'MARKDOWN'})
        assert created.status == 201, (created.status, created.text())
        slug = created.json()['slug']

        page.route('**/api/ai/paraphrase', lambda route: route.fulfill(
            status=200, content_type='application/json',
            body=json.dumps({'replacementText': 'This sentence reads clearly.', 'noop': False}),
        ))
        page.route('**/api/ai/complete', lambda route: route.fulfill(
            status=200, content_type='application/json',
            body=json.dumps({'insertion': ' with a clear ending.'}),
        ))
        page.goto(f'{BASE}/document/{slug}', wait_until='domcontentloaded')
        page.locator('.monaco-editor').first.wait_for(timeout=20000)
        page.evaluate("window.monaco.editor.getModels()[0].setValue('# Title\\n\\n')")
        page.locator('.monaco-editor').first.click()
        page.keyboard.press('Control+End')
        page.keyboard.type('"')
        value = page.evaluate('window.monaco.editor.getModels()[0].getValue()')
        assert value.endswith('""'), repr(value)

        page.evaluate("window.monaco.editor.getModels()[0].setValue('# Title\\n\\nThis sentence needs rewriting.\\n\\nA longer paragraph to complete')")
        page.locator('.monaco-editor').first.click()
        page.keyboard.press('Control+Home')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('Home')
        page.keyboard.press('Shift+End')
        expect(page.get_by_role('button', name='Paraphrase', exact=True)).to_be_enabled(timeout=5000)
        page.get_by_role('button', name='Paraphrase', exact=True).click()
        page.get_by_role('region', name='AI proposal review').wait_for(timeout=10000)
        page.get_by_role('button', name='Reject proposal').click()

        page.locator('.monaco-editor').first.click()
        page.keyboard.press('Control+End')
        page.keyboard.type(' Additional')
        page.wait_for_timeout(1500)
        page.keyboard.press('Tab')
        value = page.evaluate('window.monaco.editor.getModels()[0].getValue()')
        assert value.endswith('Additional with a clear ending.'), repr(value)
        print('Markdown quote pairing, paraphrase, and inline completion passed')

        created = context.request.post(f'{BASE}/api/document', data={'title': f'TeX smoke {time.time_ns() % 10**12}', 'format': 'LATEX'})
        assert created.status == 201, (created.status, created.text())
        latex_slug = created.json()['slug']
        page.goto(f'{BASE}/document/{latex_slug}', wait_until='domcontentloaded')
        page.locator('.monaco-editor').first.wait_for(timeout=20000)
        page.evaluate("window.monaco.editor.getModels()[0].setValue('\\\\documentclass{article}\\n\\\\begin{document}\\nThis sentence needs rewriting.\\n\\nA longer paragraph to complete\\n\\\\end{document}')")
        page.locator('.monaco-editor').first.click()
        page.keyboard.press('Control+Home')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('ArrowDown')
        page.keyboard.press('Home')
        page.keyboard.press('Shift+End')
        expect(page.get_by_role('button', name='Paraphrase', exact=True)).to_be_enabled(timeout=5000)
        page.get_by_role('button', name='Paraphrase', exact=True).click()
        page.get_by_role('region', name='AI proposal review').wait_for(timeout=10000)
        page.get_by_role('button', name='Reject proposal').click()
        page.locator('.monaco-editor').first.click()
        page.keyboard.press('Control+Home')
        for _ in range(4):
            page.keyboard.press('ArrowDown')
        page.keyboard.press('End')
        page.keyboard.type(' Additional')
        page.wait_for_timeout(1500)
        page.keyboard.press('Tab')
        value = page.evaluate('window.monaco.editor.getModels()[0].getValue()')
        assert 'Additional with a clear ending.' in value, repr(value)
        print('LaTeX paraphrase and inline completion passed')
    finally:
        if slug:
            context.request.delete(f'{BASE}/api/document/{slug}')
        if latex_slug:
            context.request.delete(f'{BASE}/api/document/{latex_slug}')
        browser.close()
