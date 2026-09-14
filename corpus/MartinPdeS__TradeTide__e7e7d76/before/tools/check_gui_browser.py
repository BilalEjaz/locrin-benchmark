"""Optional browser regression suite. Requires Playwright and Chromium.

Run: python tools/check_gui_browser.py
Screenshots are saved under the system temporary directory.
"""

import json
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright
from TradeTide.gui.server import WorkspaceServer


def main():
    server = WorkspaceServer(("127.0.0.1", 0))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    output = Path(tempfile.gettempdir()) / "tradetide-gui-review"
    output.mkdir(exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"http://127.0.0.1:{server.server_port}")
            expect(page.locator("#run")).to_be_enabled()
            expect(page.locator("#home-title")).to_have_text("Research library")
            assert page.locator(".brand img").evaluate(
                "(img) => img.complete && img.naturalWidth > 0"
            )
            page.locator("[data-preset=trend]").click()
            expect(page.locator(".indicator-card")).to_have_count(2)
            page.locator("[name=name]").fill("Trend study")
            page.locator("#save-strategy").click()
            expect(page.locator("#status")).to_have_text(
                "Strategy saved to the library."
            )
            # A large stack must not overlap the run action at any breakpoint.
            for _ in range(6):
                page.locator("#add-indicator").click()
            page.locator("#collapse-indicators").click()
            expect(page.locator(".indicator-card")).to_have_count(8)
            for width, height in [
                (1440, 1000),
                (1280, 720),
                (1024, 768),
                (768, 900),
                (390, 844),
            ]:
                page.set_viewport_size({"width": width, "height": height})
                assert page.evaluate(
                    "document.documentElement.scrollWidth <= innerWidth"
                ), width
                assert page.evaluate("""() => {
                    const run = document.querySelector('#run').getBoundingClientRect();
                    return [...document.querySelectorAll('#fields input, #fields select')]
                      .filter(n => n.getClientRects().length).every(n => {
                        const r = n.getBoundingClientRect();
                        return r.bottom <= run.top || r.top >= run.bottom || r.right <= run.left || r.left >= run.right;
                      });
                }"""), width
            page.set_viewport_size({"width": 1440, "height": 1000})
            # Load the saved two-indicator setup without losing the current draft.
            page.locator("[data-page=home]").click()
            page.locator(".saved-open").click()
            expect(page.locator(".indicator-card")).to_have_count(2)
            page.locator("#undo-draft").click()
            expect(page.locator(".indicator-card")).to_have_count(8)
            page.locator("[data-page=home]").click()
            page.locator(".saved-open").click()
            expect(page.locator(".indicator-card")).to_have_count(2)
            page.screenshot(path=str(output / "strategy.png"), full_page=True)
            # Invalid values hidden in a collapsed card must be revealed and focused.
            page.locator(".indicator-card").first.locator("[data-parameter=fast]").fill(
                "100"
            )
            page.locator("#collapse-indicators").click()
            page.locator("#tab-results").click()
            page.locator("#run").click()
            expect(page.locator("#panel-strategy")).to_be_visible()
            expect(
                page.locator(".indicator-card").first.locator("[data-parameter=fast]")
            ).to_be_focused()
            page.locator(".indicator-card").first.locator("[data-parameter=fast]").fill(
                "12"
            )
            page.locator("#run").click()
            expect(page.locator("#result-badge")).to_have_text("RUN 01", timeout=60000)
            expect(page.locator("#panel-results")).to_be_visible()
            expect(page.locator("#chart svg")).to_have_count(1)
            page.locator("#chart svg").focus()
            page.keyboard.press("ArrowRight")
            expect(page.locator("#chart-value")).to_contain_text("equity:")
            page.locator("#range-start").fill("25")
            page.locator("#range-end").fill("75")
            assert "of" in page.locator("#date-range").inner_text()
            page.locator("#reset-range").click()
            page.screenshot(path=str(output / "results.png"), full_page=True)
            # Sweep real settings, retaining the draft and the exact per-run config.
            page.locator("#tab-strategy").click()
            page.locator("#sweep-panel summary").click()
            page.locator("#sweep-parameter").select_option("stop_loss")
            page.locator("#sweep-values").fill("2, 4, 6")
            page.locator("#run-sweep").click()
            expect(page.locator("#panel-compare")).to_be_visible(timeout=60000)
            expect(page.locator("#history-rows tr")).to_have_count(4)
            expect(page.locator("#comparison-diff")).to_contain_text("Stop loss")
            expect(page.locator("#comparison-chart svg")).to_have_count(1)
            page.screenshot(path=str(output / "comparison.png"), full_page=True)
            page.locator("#tab-strategy").click()
            expect(page.locator("[name=stop_loss]")).to_have_value("4")
            # An invalid candidate stops the whole sweep before any backtest runs.
            page.locator("#sweep-values").fill("2, -1")
            page.locator("#run-sweep").click()
            expect(page.locator("#sweep-error")).not_to_be_empty()
            expect(page.locator("#run")).to_be_enabled()
            page.locator("#tab-compare").click()
            expect(page.locator("#history-rows tr")).to_have_count(4)
            page.locator(".run-link").first.click()
            expect(page.locator("#result-draft-note")).to_be_visible()
            # Filter, sort, inspect, and export the selected run's real trades.
            page.locator("#tab-execution").click()
            page.locator("#trade-outcome").select_option("profit")
            page.locator("#trade-sort").select_option("pnl-desc")
            expect(page.locator(".trade-link").first).to_be_visible()
            with page.expect_download() as csv_download:
                page.locator("#export-trades").click()
            csv = Path(csv_download.value.path()).read_text()
            assert "net_pnl" in csv and len(csv.splitlines()) > 1
            page.locator(".trade-link").first.click()
            expect(page.locator("#trade-dialog")).to_be_visible()
            expect(page.locator("#trade-detail-body")).to_contain_text("Net P&L")
            page.locator("#trade-on-chart").click()
            expect(page.locator("#panel-results")).to_be_visible()
            expect(page.locator("#chart-title")).to_contain_text("Bid close")
            # Persistence survives a full reload, including the strategy library.
            page.reload()
            expect(page.locator("#run")).to_be_enabled()
            page.locator("#tab-compare").click()
            expect(page.locator("#history-rows tr")).to_have_count(4)
            page.locator("[data-page=home]").click()
            expect(page.locator(".saved-open")).to_have_count(1)
            expect(page.locator(".recent-run")).to_have_count(4)
            page.screenshot(path=str(output / "home.png"), full_page=True)
            page.locator("[data-page=workspace]").click()
            expect(page.locator("[name=name]")).to_have_value("Trend study")
            # Import validates structure and is reversible with Undo replacement.
            imported = {
                "name": "<b>Imported RSI</b>",
                "indicators": [{"kind": "rsi", "window": 20}],
            }
            page.locator("#import-file").set_input_files(
                {
                    "name": "strategy.json",
                    "mimeType": "application/json",
                    "buffer": json.dumps(imported).encode(),
                }
            )
            expect(page.locator("[name=name]")).to_have_value("<b>Imported RSI</b>")
            expect(page.locator(".indicator-card")).to_have_count(1)
            page.locator("#undo-draft").click()
            expect(page.locator("[name=name]")).to_have_value("Trend study")
            # Stop requests leave the current native run intact and skip the queue.
            page.locator("#sweep-panel").evaluate("(node) => node.open = true")
            page.locator("#sweep-parameter").select_option("stop_loss")
            page.locator("#sweep-values").fill("3, 5, 7")
            pending = []
            page.route("**/api/backtest", lambda route: pending.append(route))
            page.locator("#run-sweep").click()
            expect(page.locator("#queue-label")).to_contain_text("1 of 3")
            expect(page.locator("#stop-queue")).to_be_visible()
            page.locator("#stop-queue").click()
            page.wait_for_timeout(200)
            assert len(pending) == 1
            pending[0].continue_()
            expect(page.locator("#status")).to_contain_text(
                "remaining runs stopped", timeout=60000
            )
            page.unroute("**/api/backtest")
            expect(page.locator("#history-rows tr")).to_have_count(5)
            # A different market gets a metrics comparison, without a misleading overlay.
            page.locator("#tab-strategy").click()
            page.locator("[name=pair]").select_option("GBP")
            page.locator("#run").click()
            expect(page.locator("#result-badge")).to_have_text("RUN 06", timeout=60000)
            page.locator("#tab-compare").click()
            page.locator("#compare-candidate").select_option(index=0)
            page.locator("#compare-baseline").select_option(index=1)
            expect(page.locator("#comparison-note")).to_contain_text(
                "Different markets"
            )
            expect(page.locator("#comparison-chart svg")).to_have_count(0)
            # Native tab keyboard interaction and mobile overflow for each view.
            page.locator("#tab-strategy").focus()
            page.keyboard.press("ArrowRight")
            expect(page.locator("#tab-results")).to_be_focused()
            for tab in ["strategy", "results", "execution", "compare"]:
                page.set_viewport_size({"width": 390, "height": 844})
                page.locator(f"#tab-{tab}").click()
                assert page.evaluate(
                    "document.documentElement.scrollWidth <= innerWidth"
                ), tab
                page.screenshot(path=str(output / f"{tab}-mobile.png"), full_page=True)
            assert not errors, errors
            # Storage failure must leave a working, exportable research session.
            isolated = browser.new_context()
            isolated.add_init_script(
                "IDBFactory.prototype.open = () => { throw new Error('Storage unavailable'); };"
            )
            unavailable = isolated.new_page()
            unavailable.goto(f"http://127.0.0.1:{server.server_port}")
            expect(unavailable.locator("#run")).to_be_enabled()
            expect(unavailable.locator("#storage-status")).to_contain_text(
                "storage unavailable"
            )
            unavailable.locator("[data-preset=reversion]").click()
            unavailable.locator("#run").click()
            expect(unavailable.locator("#result-badge")).to_have_text(
                "RUN 01", timeout=60000
            )
            expect(unavailable.locator("#export")).to_be_enabled()
            isolated.close()
            browser.close()
        (output / "result.txt").write_text(
            "PASS: persistence, saved strategies, reversible imports, sweeps, comparisons, chart ranges and keyboard inspection, trade details and CSV, validation, 8-indicator overlap regression, mobile layout.\n"
        )
        print(f"Browser checks passed. Screenshots: {output}")
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


if __name__ == "__main__":
    main()
