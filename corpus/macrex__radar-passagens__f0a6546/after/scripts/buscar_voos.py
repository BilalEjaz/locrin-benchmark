#!/usr/bin/env python3
"""Busca voos no Google Flights (via fast-flights) e imprime JSON.

Dependencias: pip install fast-flights typing_extensions requests

Uso:
  buscar_voos.py BSB CGH 2026-08-28                     # so ida
  buscar_voos.py BSB CGH 2026-08-28 --volta 2026-09-01  # ida e volta
  buscar_voos.py BSB CGH,GRU,VCP 2026-08-28 --volta 2026-09-01  # "todos" os aeroportos
  buscar_voos.py BSB CGH 2026-08-28 --max-paradas 0 --moeda BRL

Notas:
- Destino (ou origem) com virgulas = consulta cada combinacao e mescla o
  resultado num ranking unico (campo "destino" em cada voo).
- Cada voo traz "link_compra": URL do Google Flights filtrada pela cia
  daquele voo — o usuario clica, escolhe o horario listado e segue para a
  compra. O preco final se confirma no checkout.
- Em ida e volta, o Google lista as opcoes de IDA com o preco TOTAL do
  round-trip a partir daquela ida (a volta e escolhida depois no site).
- Rede: tenta o cliente nativo (primp) e cai para requests (que respeita
  HTTPS_PROXY/CA bundle). Rate limit do Google: retry com backoff.

Saida: exit 0 = ok | exit 2 = erro de argumentos (argparse) |
       exit 4 = nenhuma rota retornou voos (sem resultados).
"""
import argparse
import datetime as dtmod
import json
import os
import sys
import time

from fast_flights import FlightQuery, create_query, get_flights, parser

# console Windows (cp1252) nao imprime unicode; forca utf-8 na saida
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    )
}
GF_URL = "https://www.google.com/travel/flights"
TENTATIVAS = 3
BACKOFF = (5, 12)  # segundos entre tentativas

# nome exibido pelo Google -> codigo IATA da cia (para o filtro do link)
CIA_IATA = {"latam": "LA", "gol": "G3", "azul": "AD"}


def fetch_once(query):
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    try:
        return get_flights(query, proxy=proxy), "primp"
    except Exception:
        import requests

        html = requests.get(GF_URL, params=query.params(), headers=UA, timeout=60).text
        return parser.parse(html), "requests"


def fetch_results(query):
    """Retry com backoff: o Google devolve pagina vazia sob rate limit —
    o parser nao levanta excecao, so devolve lista vazia; por isso resultado
    vazio tambem conta como tentativa falha."""
    last = None
    for i in range(TENTATIVAS):
        try:
            res, fonte = fetch_once(query)
            if res:
                return res, fonte
            last = RuntimeError("resposta vazia (rate limit?)")
        except Exception as e:
            last = e
        if i < TENTATIVAS - 1:
            time.sleep(BACKOFF[min(i, len(BACKOFF) - 1)])
    raise last


def dt(simple):
    """Hora 0 vem como None do Google (time=[None, 25] = 00:25) — normaliza."""
    d = [x or 0 for x in list(simple.date) + [0, 0, 0]]
    t = [x or 0 for x in (list(simple.time) + [0, 0])[:2]]
    return f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}T{t[0]:02d}:{t[1]:02d}"


def codigo_cia(f):
    """f.type e o codigo IATA da cia OU a string "multi" (itinerario operado
    por mais de uma cia). "multi" NUNCA pode virar filtro de link (nao e um
    codigo valido); nesse caso so ha codigo se todas as cias do itinerario
    forem a mesma — dai usa o mapa nome->IATA."""
    nomes = [a.lower() for a in (f.airlines or [])]
    if f.type and f.type != "multi":
        return f.type
    if len(set(nomes)) == 1:
        return CIA_IATA.get(nomes[0])
    return None


def link_compra(origem, destino, data, volta, moeda, cia_codigo, max_paradas):
    """URL do Google Flights ja filtrada pela cia do voo (1 clique da compra)."""
    airlines = [cia_codigo] if cia_codigo else None
    flights = [FlightQuery(date=data, from_airport=origem, to_airport=destino,
                           max_stops=max_paradas, airlines=airlines)]
    if volta:
        flights.append(FlightQuery(date=volta, from_airport=destino, to_airport=origem,
                                   max_stops=max_paradas, airlines=airlines))
    q = create_query(flights=flights, trip="round-trip" if volta else "one-way",
                     currency=moeda, language="pt-BR")
    return q.url()


def escalas_de(legs):
    """Espera em cada conexao. Partida/chegada da mesma escala sao horarios
    locais do MESMO aeroporto, entao a subtracao direta e valida (sem TZ)."""
    out = []
    for prev, cur in zip(legs, legs[1:]):
        try:
            chegada = dtmod.datetime.fromisoformat(prev["chegada"])
            partida = dtmod.datetime.fromisoformat(cur["partida"])
            espera = int((partida - chegada).total_seconds() // 60)
        except ValueError:
            espera = None
        out.append({"aeroporto": cur["de"], "espera_min": espera})
    return out


def flight_to_dict(f, origem, destino, data, volta, moeda, max_paradas):
    legs = [
        {
            "de": s.from_airport.code,
            "para": s.to_airport.code,
            "partida": dt(s.departure),
            "chegada": dt(s.arrival),
            "duracao_min": s.duration,
            "aeronave": s.plane_type,
        }
        for s in f.flights
    ]
    escalas = escalas_de(legs)
    esperas = [e["espera_min"] for e in escalas]
    duracoes = [l["duracao_min"] for l in legs]
    # total porta-a-porta = soma dos trechos + soma das esperas (imune a fuso,
    # ao contrario de "chegada final - partida inicial" em horarios locais)
    completo = all(x is not None for x in duracoes + esperas)
    espera_total = sum(x for x in esperas if x is not None) if escalas else 0
    cia_codigo = codigo_cia(f)
    return {
        "cia_codigo": cia_codigo,
        "cias": list(f.airlines),
        "preco": f.price,
        "paradas": max(0, len(legs) - 1),
        "duracao_total_min": sum(duracoes) + espera_total if completo else None,
        "espera_total_min": espera_total if completo else None,
        "escalas": escalas,
        "origem": origem,
        "destino": destino,
        "trechos": legs,
        "link_compra": link_compra(origem, destino, data, volta, moeda, cia_codigo, max_paradas),
    }


def consulta_rota(origem, destino, data, volta, moeda, max_paradas):
    flights = [FlightQuery(date=data, from_airport=origem, to_airport=destino, max_stops=max_paradas)]
    if volta:
        flights.append(FlightQuery(date=volta, from_airport=destino, to_airport=origem, max_stops=max_paradas))
    q = create_query(flights=flights, trip="round-trip" if volta else "one-way",
                     currency=moeda, language="pt-BR")
    res, fonte = fetch_results(q)
    voos = [flight_to_dict(f, origem, destino, data, volta, moeda, max_paradas) for f in res]
    return voos, fonte, q.url()


GRANDE = 10**9
CHAVES_ORDENACAO = {
    "preco": lambda v: (v["preco"] or GRANDE, v["trechos"][0]["partida"]),
    "tempo": lambda v: (v["duracao_total_min"] if v["duracao_total_min"] is not None else GRANDE,
                        v["preco"] or GRANDE),
    "escalas": lambda v: (v["paradas"],
                          v["espera_total_min"] if v["espera_total_min"] is not None else GRANDE,
                          v["preco"] or GRANDE),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origem", help="IATA ou lista com virgulas (ex.: BSB)")
    ap.add_argument("destino", help="IATA ou lista com virgulas (ex.: CGH,GRU,VCP = todos)")
    ap.add_argument("data")
    ap.add_argument("--volta", default=None)
    ap.add_argument("--moeda", default="BRL")
    ap.add_argument("--max-paradas", type=int, default=None)
    ap.add_argument("--ordenar", choices=["preco", "tempo", "escalas"], default="preco",
                    help="preco (default) | tempo (duracao total) | "
                         "escalas (menos escalas > menor espera > preco)")
    args = ap.parse_args()

    origens = [o.strip().upper() for o in args.origem.split(",")]
    destinos = [d.strip().upper() for d in args.destino.split(",")]

    todos, voos_volta, erros, fontes, urls = [], [], [], set(), {}
    primeiro = True
    for o in origens:
        for d in destinos:
            if not primeiro:
                time.sleep(3)  # espaca consultas para nao tomar rate limit
            primeiro = False
            try:
                voos, fonte, url = consulta_rota(o, d, args.data, args.volta, args.moeda, args.max_paradas)
                todos.extend(voos)
                fontes.add(fonte)
                urls[f"{o}-{d}"] = url
            except Exception as e:
                erros.append({"rota": f"{o}-{d}", "erro": f"{type(e).__name__}: {e}"})
            if args.volta:
                # sentido inverso (one-way na data da volta): horarios, duracao
                # e esperas das opcoes de VOLTA; preco avulso, so referencia —
                # o preco total do RT ja esta na lista de ida.
                time.sleep(3)
                try:
                    vv, fonte, url = consulta_rota(d, o, args.volta, None, args.moeda, args.max_paradas)
                    voos_volta.extend(vv)
                    fontes.add(fonte)
                    urls[f"volta:{d}-{o}"] = url
                except Exception as e:
                    erros.append({"rota": f"volta:{d}-{o}", "erro": f"{type(e).__name__}: {e}"})

    if not todos:
        print(json.dumps({"erro": "nenhuma rota retornou voos", "detalhes": erros}, ensure_ascii=False))
        sys.exit(4)  # 4 = sem resultados (2 e reservado ao erro de argparse)

    por_cia, por_destino = {}, {}
    for v in todos:
        p = v["preco"]
        if p is None:
            continue
        for cia in v["cias"] or ["?"]:
            if por_cia.get(cia) is None or p < por_cia[cia]:
                por_cia[cia] = p
        if por_destino.get(v["destino"]) is None or p < por_destino[v["destino"]]:
            por_destino[v["destino"]] = p

    out = {
        "consulta": {
            "origens": origens,
            "destinos": destinos,
            "data": args.data,
            "volta": args.volta,
            "moeda": args.moeda,
            "tipo": "ida-volta" if args.volta else "ida",
        },
        "consultado_em": dtmod.datetime.now().isoformat(timespec="seconds"),
        "fonte": "google-flights/" + "+".join(sorted(fontes)),
        "urls_busca": urls,
        "n_voos": len(todos),
        "preco_minimo": min((v["preco"] for v in todos if v["preco"]), default=None),
        "preco_minimo_por_cia": dict(sorted(por_cia.items())),
        "preco_minimo_por_destino": dict(sorted(por_destino.items())),
        "erros": erros or None,
        "voos": sorted(todos, key=CHAVES_ORDENACAO[args.ordenar]),
    }
    if args.volta:
        out["nota_volta"] = (
            "precos em 'voos' sao o TOTAL ida+volta; 'voos_volta' e consulta "
            "avulsa (one-way) para horarios/duracao/esperas da volta — o "
            "preco ali e de ida avulsa, so referencia"
        )
        out["preco_minimo_volta_avulsa"] = min(
            (v["preco"] for v in voos_volta if v["preco"]), default=None)
        out["voos_volta"] = sorted(voos_volta, key=CHAVES_ORDENACAO[args.ordenar])
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
