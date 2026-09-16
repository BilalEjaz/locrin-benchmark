#!/usr/bin/env python3
"""Varre um intervalo de datas e acha os periodos mais baratos.

Uso (ida e volta com duracao fixa, varrendo a data de ida):
  melhor_periodo.py BSB CGH --inicio 2026-08-20 --fim 2026-09-10 --duracao 4

Uso (so ida, preco por dia):
  melhor_periodo.py BSB CGH --inicio 2026-08-20 --fim 2026-09-10

Uso (amostragem: so N datas espalhadas na janela — periodos grandes/ano):
  melhor_periodo.py BSB CGH --inicio 2026-09-01 --fim 2026-09-30 --amostra 5

Uso (paralelo: N datas consultadas ao mesmo tempo — default 6):
  melhor_periodo.py BSB CGH --inicio 2026-09-01 --fim 2026-09-30 --amostra 5 --paralelo 6

Imprime JSON: preco minimo por data de ida, ordenado do mais barato.
Uma consulta por data, 6 em paralelo por padrao. Medido em 2026-07-25
(BSB-CGH, 7 datas): sequencial 63s | --paralelo 4 47s | --paralelo 7 20s;
12 datas com --paralelo 12 em 8s, sem rate limit e sem perda de resultado.
Resposta vazia sob carga e sintoma de rate limit e o buscar_voos ja repete
com backoff, entao paralelismo alto degrada o tempo, nunca o dado.
--paralelo 1 volta ao sequencial com --pausa. A ordem das datas na saida
nao depende do paralelismo.
"""
import argparse
import datetime as dtmod
import json
import statistics
import subprocess
import sys
import time
import os
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))

DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]


def consulta(origem, destino, data, volta, moeda):
    cmd = [sys.executable, os.path.join(HERE, "buscar_voos.py"), origem, destino, data, "--moeda", moeda]
    if volta:
        cmd += ["--volta", volta]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", timeout=120)
    except subprocess.TimeoutExpired:
        return None
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return None


def calcula_estatisticas(precos):
    if not precos:
        return {"n": 0, "min": None, "p25": None, "mediana": None, "max": None}
    n = len(precos)
    mediana = statistics.median(precos)
    p25 = statistics.quantiles(precos, n=4, method="inclusive")[0] if n >= 2 else mediana
    return {"n": n, "min": min(precos), "p25": p25, "mediana": mediana, "max": max(precos)}


def calcula_por_dia_semana(linhas_ok):
    grupos = {d: [] for d in DIAS_SEMANA}
    for l in linhas_ok:
        dia = DIAS_SEMANA[dtmod.date.fromisoformat(l["ida"]).weekday()]
        grupos[dia].append(l["preco_minimo"])
    out = {}
    for dia in DIAS_SEMANA:
        precos = grupos[dia]
        if precos:
            out[dia] = {"min": min(precos), "mediana": statistics.median(precos), "n": len(precos)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origem")
    ap.add_argument("destino")
    ap.add_argument("--inicio", required=True)
    ap.add_argument("--fim", required=True)
    ap.add_argument("--duracao", type=int, default=None, help="noites; se dado, consulta ida-volta")
    ap.add_argument("--moeda", default="BRL")
    ap.add_argument("--pausa", type=float, default=1.5)
    ap.add_argument("--amostra", type=int, default=None,
                    help="consultar so N datas espalhadas uniformemente na janela (em vez de todas)")
    ap.add_argument("--paralelo", type=int, default=6,
                    help="consultas simultaneas (default 6; 1 = sequencial com --pausa)")
    args = ap.parse_args()
    args.paralelo = max(1, args.paralelo)

    d0 = dtmod.date.fromisoformat(args.inicio)
    d1 = dtmod.date.fromisoformat(args.fim)
    datas = [d0 + dtmod.timedelta(days=i) for i in range((d1 - d0).days + 1)]
    if args.amostra and 0 < args.amostra < len(datas):
        n = args.amostra
        # indices espalhados uniformemente, sempre incluindo as pontas
        idxs = sorted({round(i * (len(datas) - 1) / (n - 1)) for i in range(n)}) if n > 1 else [0]
        datas = [datas[i] for i in idxs]

    def uma_data(d):
        # "is not None": --duracao 0 e valido (bate-volta no mesmo dia)
        volta = (d + dtmod.timedelta(days=args.duracao)).isoformat() if args.duracao is not None else None
        r = consulta(args.origem, args.destino, d.isoformat(), volta, args.moeda)
        linha = {
            "ida": d.isoformat(),
            "volta": volta,
            "preco_minimo": (r or {}).get("preco_minimo"),
            "n_voos": (r or {}).get("n_voos", 0),
            "erro": None if r else "consulta falhou",
        }
        print(f"# {d.isoformat()} -> {linha['preco_minimo']}", file=sys.stderr)
        return linha

    if args.paralelo > 1:
        # subprocessos: o GIL nao atrapalha, as threads so esperam I/O.
        # map preserva a ordem das datas, independente da ordem de chegada.
        with ThreadPoolExecutor(max_workers=args.paralelo) as pool:
            linhas = list(pool.map(uma_data, datas))
    else:
        linhas = []
        for d in datas:
            linhas.append(uma_data(d))
            time.sleep(args.pausa)

    ok = [l for l in linhas if l["preco_minimo"]]
    out = {
        "consulta": vars(args),
        "consultado_em": dtmod.datetime.now().isoformat(timespec="seconds"),
        "estatisticas": calcula_estatisticas([l["preco_minimo"] for l in ok]),
        "por_dia_semana": calcula_por_dia_semana(ok),
        "melhores": sorted(ok, key=lambda l: l["preco_minimo"])[:10],
        "todas": linhas,
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
