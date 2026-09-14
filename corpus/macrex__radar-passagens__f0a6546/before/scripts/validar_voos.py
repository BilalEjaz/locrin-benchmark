#!/usr/bin/env python3
"""Valida que os resultados de buscar_voos.py sao corretos e plausiveis.

Uso (exemplo canonico BSB->CGH):
  validar_voos.py BSB CGH 2026-08-28 --volta 2026-09-01 \
      --cias-esperadas LATAM,Gol --preco-min 150 --preco-max 8000 \
      --duracao-min 80 --duracao-max 150

Regras verificadas:
  R1 aeroportos da resposta batem com a consulta (ida: origem->destino)
  R2 data de partida de cada voo bate com a data pedida
  R3 quantidade minima de voos encontrada (--n-min, default 3)
  R4 pelo menos 2 das cias esperadas presentes (se --cias-esperadas)
  R5 todos os precos dentro da faixa plausivel [--preco-min, --preco-max]
  R6 duracao dos trechos dentro de [--duracao-min, --duracao-max] (se dados)
  R7 anti-stale: consulta numa data ~3 semanas depois retorna conjunto de
     precos DIFERENTE (se identico, o dado pode estar congelado/cacheado)
  R8 consistencia: repetir a MESMA consulta muda o preco minimo em < 25%

Exit 0 = todas as regras passaram; exit 1 = alguma falhou.
"""
import argparse
import datetime as dtmod
import json
import os
import subprocess
import sys
import time

# console Windows (cp1252) nao imprime unicode das mensagens (ex.: >=)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))


def consulta(origem, destino, data, volta=None, moeda="BRL"):
    cmd = [sys.executable, os.path.join(HERE, "buscar_voos.py"), origem, destino, data, "--moeda", moeda]
    if volta:
        cmd += ["--volta", volta]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise RuntimeError(f"buscar_voos falhou: {p.stdout[:300]} {p.stderr[:300]}")
    return json.loads(p.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origem")
    ap.add_argument("destino")
    ap.add_argument("data")
    ap.add_argument("--volta", default=None)
    ap.add_argument("--moeda", default="BRL")
    ap.add_argument("--cias-esperadas", default=None, help="ex.: LATAM,Gol,Azul")
    ap.add_argument("--preco-min", type=float, default=50)
    ap.add_argument("--preco-max", type=float, default=20000)
    ap.add_argument("--duracao-min", type=int, default=None)
    ap.add_argument("--duracao-max", type=int, default=None)
    ap.add_argument("--n-min", type=int, default=3)
    args = ap.parse_args()

    resultados = []

    def regra(cod, desc, ok, detalhe=""):
        resultados.append((cod, desc, ok, detalhe))
        print(f"{'PASS' if ok else 'FAIL'} {cod} {desc}" + (f" — {detalhe}" if detalhe else ""))

    r = consulta(args.origem, args.destino, args.data, args.volta, args.moeda)
    voos = r["voos"]

    # R1 aeroportos
    ruins = [v for v in voos if v["trechos"][0]["de"] != args.origem.upper()
             or v["trechos"][-1]["para"] != args.destino.upper()]
    regra("R1", "aeroportos batem com a consulta", not ruins,
          f"{len(ruins)} voo(s) com rota divergente" if ruins else f"{len(voos)} voos {args.origem}->{args.destino}")

    # R2 datas
    ruins = [v for v in voos if not v["trechos"][0]["partida"].startswith(args.data)]
    regra("R2", "data de partida bate com a pedida", not ruins,
          f"{len(ruins)} voo(s) fora de {args.data}" if ruins else args.data)

    # R3 quantidade
    regra("R3", f"pelo menos {args.n_min} voos", len(voos) >= args.n_min, f"n={len(voos)}")

    # R4 cias esperadas
    if args.cias_esperadas:
        esperadas = {c.strip().lower() for c in args.cias_esperadas.split(",")}
        vistas = {c.lower() for v in voos for c in v["cias"]}
        inter = esperadas & vistas
        regra("R4", f"≥2 cias esperadas presentes ({args.cias_esperadas})", len(inter) >= 2,
              f"vistas: {sorted(vistas)}")

    # R5 faixa de preco
    precos = [v["preco"] for v in voos if v["preco"]]
    fora = [p for p in precos if not (args.preco_min <= p <= args.preco_max)]
    regra("R5", f"precos em [{args.preco_min:g}, {args.preco_max:g}] {args.moeda}", bool(precos) and not fora,
          f"min={min(precos) if precos else '-'} max={max(precos) if precos else '-'} fora={len(fora)}")

    # R6 duracao
    if args.duracao_min and args.duracao_max:
        durs = [t["duracao_min"] for v in voos for t in v["trechos"] if t["duracao_min"]]
        fora = [d for d in durs if not (args.duracao_min <= d <= args.duracao_max)]
        regra("R6", f"duracoes em [{args.duracao_min}, {args.duracao_max}] min", not fora,
              f"{sorted(set(durs))} — {len(fora)} fora" if durs else "sem duracoes")

    # R7 anti-stale: outra data deve dar conjunto de precos diferente
    d2 = (dtmod.date.fromisoformat(args.data) + dtmod.timedelta(days=18)).isoformat()
    time.sleep(5)  # espaco entre consultas: evita falso-negativo por rate limit
    v2 = (dtmod.date.fromisoformat(args.volta) + dtmod.timedelta(days=18)).isoformat() if args.volta else None
    try:
        r2 = consulta(args.origem, args.destino, d2, v2, args.moeda)
        set1, set2 = set(precos), {v["preco"] for v in r2["voos"] if v["preco"]}
        regra("R7", "precos variam entre datas (anti-stale)", bool(set2) and set1 != set2,
              f"{args.data}: {sorted(set1)[:5]} vs {d2}: {sorted(set2)[:5]}")
    except Exception as e:
        regra("R7", "precos variam entre datas (anti-stale)", False, f"consulta de controle falhou: {e}")

    # R8 consistencia: repetir a mesma consulta
    time.sleep(5)  # espaco entre consultas: evita falso-negativo por rate limit
    try:
        r3 = consulta(args.origem, args.destino, args.data, args.volta, args.moeda)
        m1, m3 = r["preco_minimo"], r3["preco_minimo"]
        ok = m1 and m3 and abs(m1 - m3) / m1 < 0.25
        regra("R8", "repeticao da consulta estavel (<25%)", bool(ok), f"{m1} vs {m3}")
    except Exception as e:
        regra("R8", "repeticao da consulta estavel (<25%)", False, str(e))

    falhas = [c for c, _, ok, _ in resultados if not ok]
    print(f"\nRESULTADO: {len(resultados) - len(falhas)}/{len(resultados)} regras passaram"
          + (f" — FALHOU: {', '.join(falhas)}" if falhas else " — tudo OK"))
    print(f"preco minimo {r['consulta']['tipo']}: {r['preco_minimo']} {args.moeda} | por cia: {r['preco_minimo_por_cia']}")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
