#!/usr/bin/env python3
"""Fonte alternativa: cache de precos do Aviasales (Travelpayouts Data API v3).

PRECOS DE CACHE (~48h): menores tarifas vistas por usuarios Aviasales,
incluindo OTAs. Sao ESTIMATIVAS — o preco pode ter mudado; sempre confirmar
no link. Complementa (nao substitui) o buscar_voos.py (Google Flights ao
vivo). Saida espelha o formato do buscar_voos.py.

Uso:
  fonte_aviasales.py BSB CGH 2026-08-28                     # so ida
  fonte_aviasales.py BSB CGH 2026-08-28 --volta 2026-09-01  # ida e volta
  fonte_aviasales.py BSB MAD 2027-02 --volta 2027-02        # mes inteiro

Requisitos:
  env TRAVELPAYOUTS_TOKEN  (obrigatorio) — token de travelpayouts.com
  env TRAVELPAYOUTS_MARKER (opcional)    — marker de afiliado no link_compra

Saida: exit 0 = ok | exit 2 = erro de argumentos (argparse) |
       exit 3 = pre-requisito ausente (token/requests) |
       exit 4 = cache sem dados para a(s) rota(s)/data(s).

A faixa de sanidade de preco e em BRL e so se aplica com --moeda BRL
(em CLP/COP/JPY os valores nominais sao muito maiores e zerariam tudo).
"""
import argparse
import datetime as dtmod
import json
import os
import sys
import time

API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"
LINK_BASE = "https://www.aviasales.com"
IDADE_MAX_DIAS = 7      # cache mais velho que isso e descartado
PRECO_MIN, PRECO_MAX = 50, 20000  # faixa de sanidade (BRL), como no validar_voos

CIA_NOME = {
    "LA": "LATAM", "G3": "Gol", "AD": "Azul", "IB": "Iberia",
    "UX": "Air Europa", "TP": "TAP", "AF": "Air France", "KL": "KLM",
    "AV": "Avianca", "CM": "Copa", "AA": "American", "DL": "Delta",
    "UA": "United", "LH": "Lufthansa", "EK": "Emirates", "TK": "Turkish",
}


def erro_saida(codigo, payload):
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(codigo)


def idade_dias(found_at, agora):
    try:
        visto = dtmod.datetime.fromisoformat(found_at.replace("Z", "+00:00"))
        agora_utc = agora.astimezone(dtmod.timezone.utc) if agora.tzinfo else agora.replace(tzinfo=dtmod.timezone.utc)
        return (agora_utc - visto).total_seconds() / 86400
    except (ValueError, AttributeError):
        return None


def link_compra(fragmento, marker):
    if not fragmento:
        return None
    url = LINK_BASE + fragmento
    if marker:
        url += ("&" if "?" in url else "?") + f"marker={marker}"
    return url


def transformar(itens, origem, destino, marker, agora, faixa_brl=True):
    """Itens crus da API -> voos no formato do buscar_voos.py.
    Filtra cache velho (> IDADE_MAX_DIAS, quando found_at existe) e preco
    fora da faixa de sanidade. A faixa e em BRL: com outra moeda
    (faixa_brl=False) so o tipo do preco e checado, senao CLP/COP/JPY —
    onde o valor nominal e ordens de grandeza maior — zerariam tudo.
    Retorna (voos, n_descartados)."""
    voos, descartados = [], 0
    for it in itens:
        preco = it.get("price")
        if not isinstance(preco, (int, float)):
            descartados += 1
            continue
        if faixa_brl and not (PRECO_MIN <= preco <= PRECO_MAX):
            descartados += 1
            continue
        visto_em = it.get("found_at")
        if visto_em is not None:
            idade = idade_dias(visto_em, agora)
            if idade is not None and idade > IDADE_MAX_DIAS:
                descartados += 1
                continue
        cia = it.get("airline") or "?"
        voos.append({
            "cia_codigo": cia,
            "cias": [CIA_NOME.get(cia, cia)],
            "preco": preco,
            "paradas": it.get("transfers"),
            "paradas_volta": it.get("return_transfers"),
            "duracao_total_min": it.get("duration_to"),
            "duracao_volta_min": it.get("duration_back"),
            "espera_total_min": None,   # cache nao expoe esperas por conexao
            "escalas": None,
            "origem": it.get("origin") or origem,
            "destino": it.get("destination") or destino,
            "partida": it.get("departure_at"),
            "retorno": it.get("return_at"),
            "visto_em": visto_em,
            "expira_em": it.get("expires_at"),
            "link_compra": link_compra(it.get("link"), marker),
        })
    return voos, descartados


GRANDE = 10**9
CHAVES_ORDENACAO = {
    "preco": lambda v: (v["preco"] or GRANDE, v["partida"] or ""),
    "tempo": lambda v: (v["duracao_total_min"] if v["duracao_total_min"] is not None else GRANDE,
                        v["preco"] or GRANDE),
    "escalas": lambda v: (v["paradas"] if v["paradas"] is not None else GRANDE,
                          v["preco"] or GRANDE),
}


def consulta_rota(origem, destino, args, token, requests):
    params = {
        "origin": origem,
        "destination": destino,
        "departure_at": args.data,
        "currency": args.moeda.lower(),
        "sorting": "price",
        "limit": args.limite,
        "unique": "false",
        "one_way": "false" if args.volta else "true",
        "token": token,
    }
    if args.volta:
        params["return_at"] = args.volta
    r = requests.get(API, params=params, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    corpo = r.json()
    if not corpo.get("success", False):
        raise RuntimeError(f"success=false: {json.dumps(corpo)[:200]}")
    return corpo.get("data") or []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origem", help="IATA ou lista com virgulas")
    ap.add_argument("destino", help="IATA ou lista com virgulas")
    ap.add_argument("data", help="YYYY-MM-DD ou YYYY-MM (mes inteiro)")
    ap.add_argument("--volta", default=None)
    ap.add_argument("--moeda", default="BRL")
    ap.add_argument("--limite", type=int, default=30)
    ap.add_argument("--ordenar", choices=["preco", "tempo", "escalas"], default="preco")
    args = ap.parse_args()

    # import aqui (e nao dentro da consulta): antes, requests ausente virava
    # excecao por rota e o script saia como "cache sem dados"
    try:
        import requests
    except ImportError:
        erro_saida(3, {
            "fonte": "aviasales-cache",
            "erro": "requests nao instalado: pip install requests",
        })

    token = os.environ.get("TRAVELPAYOUTS_TOKEN")
    if not token:
        erro_saida(3, {
            "erro": "TRAVELPAYOUTS_TOKEN ausente",
            "como_obter": "conta gratis em travelpayouts.com -> Profile -> API token; "
                          "depois: setx TRAVELPAYOUTS_TOKEN \"<token>\" (e opcional "
                          "setx TRAVELPAYOUTS_MARKER \"<marker>\")",
        })
    marker = os.environ.get("TRAVELPAYOUTS_MARKER")

    origens = [o.strip().upper() for o in args.origem.split(",")]
    destinos = [d.strip().upper() for d in args.destino.split(",")]
    agora = dtmod.datetime.now(dtmod.timezone.utc)

    faixa_brl = args.moeda.upper() == "BRL"

    todos, erros, descartados = [], [], 0
    for o in origens:
        for d in destinos:
            try:
                itens = consulta_rota(o, d, args, token, requests)
                voos, desc = transformar(itens, o, d, marker, agora, faixa_brl)
                todos.extend(voos)
                descartados += desc
            except Exception as e:
                erros.append({"rota": f"{o}-{d}", "erro": f"{type(e).__name__}: {e}"})
            time.sleep(0.3)

    if not todos:
        payload = {
            "fonte": "aviasales-cache",
            "erro": "cache sem dados para a(s) rota(s)/data(s)",
            "descartados_por_sanidade": descartados,
            "detalhes": erros or None,
        }
        if descartados:
            payload["dica"] = (
                f"{descartados} resultado(s) descartado(s): preco fora da faixa de sanidade "
                f"BRL [{PRECO_MIN}, {PRECO_MAX}] (aplicada porque --moeda BRL) "
                f"ou cache mais velho que {IDADE_MAX_DIAS} dias"
                if faixa_brl else
                f"{descartados} resultado(s) descartado(s): preco invalido ou cache mais "
                f"velho que {IDADE_MAX_DIAS} dias (faixa BRL nao aplicada em {args.moeda.upper()})"
            )
        erro_saida(4, payload)

    por_cia = {}
    for v in todos:
        for cia in v["cias"]:
            if por_cia.get(cia) is None or v["preco"] < por_cia[cia]:
                por_cia[cia] = v["preco"]

    out = {
        "consulta": {
            "origens": origens,
            "destinos": destinos,
            "data": args.data,
            "volta": args.volta,
            "moeda": args.moeda,
            "tipo": "ida-volta" if args.volta else "ida",
        },
        "fonte": "aviasales-cache",
        "aviso": "precos de CACHE (~48h) vistos por usuarios Aviasales - "
                 "ESTIMATIVAS; confirmar no link_compra",
        "n_voos": len(todos),
        "descartados_por_sanidade": descartados or None,
        "preco_minimo": min(v["preco"] for v in todos),
        "preco_minimo_por_cia": dict(sorted(por_cia.items())),
        "erros": erros or None,
        "voos": sorted(todos, key=CHAVES_ORDENACAO[args.ordenar]),
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
