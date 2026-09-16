#!/usr/bin/env python3
"""Teste de selecao da skill: diz o que da para rodar nesta maquina.

Checa Python, dependencias core (busca no Google Flights), extras de
metabusca (Playwright + Chrome) e o token do Aviasales. Imprime um JSON e
SEMPRE sai com codigo 0 — e diagnostico, nunca quebra o fluxo. Usa apenas a
biblioteca padrao, entao roda mesmo com nada instalado.

Uso:
  checar_ambiente.py
"""
import importlib.util
import json
import os
import platform
import shutil
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
REQUIREMENTS = os.path.join(RAIZ, "requirements.txt")

DEPS_CORE = ["fast_flights", "requests", "typing_extensions"]
PYTHON_MINIMO = (3, 9)

CHROME_COMANDOS = [
    "google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser",
]
CHROME_CAMINHOS = [
    r"C:/Program Files/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
]


def tem_modulo(nome):
    try:
        return importlib.util.find_spec(nome) is not None
    except (ImportError, ValueError):
        return False


def tem_chrome():
    for cmd in CHROME_COMANDOS:
        if shutil.which(cmd):
            return True
    return any(os.path.exists(c) for c in CHROME_CAMINHOS)


def main():
    deps_core = {nome: tem_modulo(nome) for nome in DEPS_CORE}
    faltando_core = sorted(n for n, ok in deps_core.items() if not ok)
    deps_metabusca = {"playwright": tem_modulo("playwright"), "chrome": tem_chrome()}
    core_ok = not faltando_core
    metabusca_ok = all(deps_metabusca.values())

    if not core_ok:
        modo = "instalar-dependencias"
    elif metabusca_ok:
        modo = "completa"
    else:
        modo = "completa-sem-metabusca"

    print(json.dumps({
        "python": platform.python_version(),
        "python_ok": sys.version_info >= PYTHON_MINIMO,
        "deps_core": deps_core,
        "deps_metabusca": deps_metabusca,
        "travelpayouts_token": bool(os.environ.get("TRAVELPAYOUTS_TOKEN")),
        "faltando_core": faltando_core,
        "comando_install": f"{sys.executable} -m pip install -r {REQUIREMENTS}",
        "modo_recomendado": modo,
    }, ensure_ascii=False, indent=1))
    sys.exit(0)


if __name__ == "__main__":
    main()
