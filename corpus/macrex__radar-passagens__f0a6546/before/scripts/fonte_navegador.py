#!/usr/bin/env python3
"""3a fonte: metabuscadores (Kayak/Skyscanner) via navegador real (Playwright).

O anti-bot desses sites bloqueia HTTP puro E o Chromium empacotado do
Playwright; o que passa e o Chrome instalado na maquina (channel="chrome")
com UA realista. Precos sao REAIS (metabusca ao vivo, inclui tarifas de OTAs)
e costumam ficar abaixo do Google Flights — confirmar no site do vendedor.

Dependencias: pip install playwright && python -m playwright install chromium
(e ter Google Chrome instalado; sem ele cai para o Chromium do Playwright,
que costuma ser bloqueado).

Uso:
  fonte_navegador.py BSB CGH 2026-08-28 --volta 2026-09-01
  fonte_navegador.py BSB CGH 2026-08-28 --site todos

FAIL-OPEN: qualquer erro/bloqueio imprime JSON com "erros" e sai com codigo 0
— esta fonte NUNCA quebra a busca principal (Google Flights).
"""
import argparse
import datetime as dtmod
import json
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
ESPERA_RENDER_MS = 12000
MAX_CARDS = 10
PRECO_RE = re.compile(r"R\$\s*([\d.]{3,9})")
HORARIO_RE = re.compile(r"(\d{1,2}:\d{2})\s*.\s*(\d{1,2}:\d{2})")
DURACAO_RE = re.compile(r"(\d+)h\s*(\d+)?min|(\d+)h\b")
CIAS_CONHECIDAS = ["LATAM", "GOL", "Azul", "TAP", "American", "United", "Delta",
                   "Copa", "Avianca", "Iberia", "Air France", "KLM", "Lufthansa",
                   "British", "Emirates", "Qatar", "Turkish", "Aerolineas"]
BLOQUEIO_RE = re.compile(r"(o que .{0,3} um bot|are you a person|not a robot|captcha|access denied)", re.I)

SITES = {
    "kayak": {
        "url": lambda o, d, i, v: f"https://www.kayak.com.br/flights/{o}-{d}/{i}"
                                  + (f"/{v}" if v else "") + "?sort=bestflight_a",
        "card": 'div[class*="nrc6-wrapper"]',
    },
    "skyscanner": {
        "url": lambda o, d, i, v: f"https://www.skyscanner.com.br/transport/flights/{o.lower()}/{d.lower()}/"
                                  + dtmod.date.fromisoformat(i).strftime("%y%m%d") + "/"
                                  + (dtmod.date.fromisoformat(v).strftime("%y%m%d") + "/" if v else ""),
        "card": '[class*="FlightsResults_dayViewItem"], [class*="ItineraryStack"]',
    },
}


def preco_de(texto):
    for bruto in PRECO_RE.findall(texto):
        try:
            p = float(bruto.replace(".", ""))
        except ValueError:
            continue
        if 100 <= p <= 50000:
            return p
    return None


def parse_card(texto):
    txt = texto.replace("\xa0", " ")
    preco = preco_de(txt)
    if preco is None:
        return None
    horarios = ["-".join(h) for h in HORARIO_RE.findall(txt)][:2]
    duracoes = [m.group(0) for m in DURACAO_RE.finditer(txt)][:2]
    return {
        "preco": preco,
        "cias": [c for c in CIAS_CONHECIDAS if c.lower() in txt.lower()],
        "horarios": horarios,          # [ida, volta] quando ida-volta
        "duracoes": duracoes,
        "paradas": "direto" if "direto" in txt.lower() else ("com escala" if "escala" in txt.lower() else None),
        "anuncio": "anúncio" in txt.lower() or "anúncio" in txt.lower(),
    }


def consulta_site(page, site, url):
    page.goto(url, timeout=50000, wait_until="domcontentloaded")
    page.wait_for_timeout(ESPERA_RENDER_MS)
    corpo = page.inner_text("body")
    if BLOQUEIO_RE.search(corpo):
        raise RuntimeError("pagina de bloqueio/captcha (anti-bot)")
    cards = page.locator(SITES[site]["card"])
    voos = []
    for i in range(min(MAX_CARDS, cards.count())):
        try:
            v = parse_card(cards.nth(i).inner_text())
        except Exception:
            continue
        if v:
            voos.append(v)
    if not voos:
        raise RuntimeError("nenhum resultado legivel no DOM (layout mudou?)")
    precos = [v["preco"] for v in voos if not v["anuncio"]] or [v["preco"] for v in voos]
    return {
        "site": site,
        "url": url,
        "n_voos": len(voos),
        "preco_minimo": min(precos),
        "voos": sorted(voos, key=lambda v: v["preco"]),
    }


def abre_navegador(pw):
    """Chrome instalado passa no anti-bot; Chromium do Playwright normalmente nao."""
    try:
        return pw.chromium.launch(channel="chrome", headless=True,
                                  args=["--disable-blink-features=AutomationControlled"]), "chrome"
    except Exception:
        return pw.chromium.launch(headless=True,
                                  args=["--disable-blink-features=AutomationControlled"]), "chromium"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origem")
    ap.add_argument("destino")
    ap.add_argument("data")
    ap.add_argument("--volta", default=None)
    ap.add_argument("--site", choices=["kayak", "skyscanner", "todos"], default="kayak")
    ap.add_argument("--moeda", default="BRL", help="informativo; os sites .com.br ja usam BRL")
    args = ap.parse_args()

    origem, destino = args.origem.upper(), args.destino.upper()
    sites = ["kayak", "skyscanner"] if args.site == "todos" else [args.site]

    out = {
        "consulta": {"origem": origem, "destino": destino, "data": args.data,
                     "volta": args.volta, "tipo": "ida-volta" if args.volta else "ida"},
        "fonte": "metabusca-navegador",
        "nota": ("precos REAIS de metabusca (incluem tarifas de OTAs, costumam ficar abaixo "
                 "do Google) — confirmar no site do vendedor antes de comprar"),
        "consultado_em": dtmod.datetime.now().isoformat(timespec="seconds"),
        "resultados": [],
        "erros": [],
    }

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        out["erros"] = ["playwright nao instalado: pip install playwright && python -m playwright install chromium"]
        out["preco_minimo"] = None
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return  # fail-open

    with sync_playwright() as pw:
        browser, canal = abre_navegador(pw)
        out["navegador"] = canal
        ctx = browser.new_context(locale="pt-BR", user_agent=UA, viewport={"width": 1366, "height": 850})
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        page = ctx.new_page()
        for site in sites:
            url = SITES[site]["url"](origem, destino, args.data, args.volta)
            try:
                out["resultados"].append(consulta_site(page, site, url))
            except Exception as e:  # fail-open por site
                out["erros"].append({"site": site, "url": url, "erro": f"{type(e).__name__}: {str(e)[:200]}"})
        browser.close()

    minimos = [r["preco_minimo"] for r in out["resultados"]]
    out["preco_minimo"] = min(minimos) if minimos else None
    out["erros"] = out["erros"] or None
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
