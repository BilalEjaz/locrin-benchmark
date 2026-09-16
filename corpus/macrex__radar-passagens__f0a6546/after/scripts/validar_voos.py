#!/usr/bin/env python3
"""Valida que os resultados de buscar_voos.py sao corretos e plausiveis.

DOIS MODOS:

1) Sobre um JSON ja produzido (--json ARQUIVO) — custo zero de rede, valida
   exatamente os dados que serao reportados ao usuario. Roda R1-R6; R7/R8
   (que exigem consultas ao vivo) so rodam com --anti-stale.
     buscar_voos.py BSB CGH 2026-08-28 > /tmp/voos.json && \
       validar_voos.py BSB CGH 2026-08-28 --json /tmp/voos.json

2) Consulta propria (sem --json) — chama buscar_voos.py e roda R1-R8.
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
  R7 anti-stale: consulta na data +18 dias retorna conjunto de precos
     DIFERENTE (se identico, o dado pode estar congelado/cacheado).
     Vira SKIP (nao FAIL) se a data de controle passa do horizonte de
     reserva (~330 dias) ou se a consulta de controle falha/volta vazia.
  R8 consistencia: repetir a MESMA consulta muda o preco minimo em < 25%

Exit 0 = todas as regras passaram (SKIP nao reprova)
Exit 1 = alguma regra falhou
Exit 3 = nao foi possivel consultar (rede/buscar_voos falhou)
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
HORIZONTE_RESERVA_DIAS = 330  # alem disso o Google nao vende passagem


def consulta(origem, destino, data, volta=None, moeda="BRL"):
    cmd = [sys.executable, os.path.join(HERE, "buscar_voos.py"), origem, destino, data, "--moeda", moeda]
    if volta:
        cmd += ["--volta", volta]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", timeout=120)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"buscar_voos excedeu 120s ({origem}->{destino} {data})")
    if p.returncode != 0:
        raise RuntimeError(f"buscar_voos falhou (exit {p.returncode}): "
                           f"{(p.stdout or '')[:300]} {(p.stderr or '')[:300]}")
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
    ap.add_argument("--json", dest="arquivo_json", default=None,
                    help="valida um JSON ja salvo de buscar_voos.py (sem consulta nova); "
                         "nesse modo R7/R8 so rodam com --anti-stale")
    ap.add_argument("--anti-stale", action="store_true",
                    help="com --json: roda tambem R7/R8 (fazem consultas ao vivo)")
    args = ap.parse_args()

    resultados = []

    def regra(cod, desc, ok, detalhe=""):
        """ok: True = PASS | False = FAIL | "SKIP" = nao avaliado (nao reprova)."""
        resultados.append((cod, desc, ok, detalhe))
        rotulo = "SKIP" if ok == "SKIP" else ("PASS" if ok else "FAIL")
        print(f"{rotulo} {cod} {desc}" + (f" — {detalhe}" if detalhe else ""))

    if args.arquivo_json:
        try:
            with open(args.arquivo_json, encoding="utf-8") as fh:
                r = json.load(fh)
            voos = r["voos"]
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"ERRO: nao foi possivel ler o JSON '{args.arquivo_json}': "
                  f"{type(e).__name__}: {e}")
            sys.exit(3)
        print(f"# modo --json: validando {args.arquivo_json} (sem consulta nova)")
    else:
        try:
            r = consulta(args.origem, args.destino, args.data, args.volta, args.moeda)
            voos = r["voos"]
        except Exception as e:
            print(f"ERRO: nao foi possivel consultar {args.origem}->{args.destino} "
                  f"em {args.data}: {type(e).__name__}: {e}")
            sys.exit(3)

    # R1 aeroportos — origem/destino podem ser LISTAS ("CGH,GRU,VCP"): cada voo
    # usa um IATA so, entao a checagem e de pertinencia ao conjunto pedido
    origens = {x.strip().upper() for x in args.origem.split(",") if x.strip()}
    destinos = {x.strip().upper() for x in args.destino.split(",") if x.strip()}
    ruins = [v for v in voos if v["trechos"][0]["de"] not in origens
             or v["trechos"][-1]["para"] not in destinos]
    regra("R1", "aeroportos batem com a consulta", not ruins,
          f"{len(ruins)} voo(s) com rota divergente" if ruins
          else f"{len(voos)} voos {'/'.join(sorted(origens))}->{'/'.join(sorted(destinos))}")

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

    # R7/R8 exigem consultas ao vivo: no modo --json so com --anti-stale
    ao_vivo = (not args.arquivo_json) or args.anti_stale
    if not ao_vivo:
        print("# R7/R8 nao rodados (modo --json sem --anti-stale: exigem consulta ao vivo)")

    if ao_vivo:
        # R7 anti-stale: outra data deve dar conjunto de precos diferente
        d2_data = dtmod.date.fromisoformat(args.data) + dtmod.timedelta(days=18)
        d2 = d2_data.isoformat()
        alem_horizonte = (d2_data - dtmod.date.today()).days > HORIZONTE_RESERVA_DIAS
        time.sleep(5)  # espaco entre consultas: evita falso-negativo por rate limit
        v2 = (dtmod.date.fromisoformat(args.volta) + dtmod.timedelta(days=18)).isoformat() if args.volta else None
        if alem_horizonte:
            regra("R7", "precos variam entre datas (anti-stale)", "SKIP",
                  f"data de controle {d2} passa do horizonte de reserva "
                  f"(~{HORIZONTE_RESERVA_DIAS} dias) — sem voos a comparar")
        else:
            try:
                r2 = consulta(args.origem, args.destino, d2, v2, args.moeda)
                set1, set2 = set(precos), {v["preco"] for v in r2["voos"] if v["preco"]}
                if not set2:
                    regra("R7", "precos variam entre datas (anti-stale)", "SKIP",
                          f"consulta de controle ({d2}) sem precos — nada a comparar")
                else:
                    regra("R7", "precos variam entre datas (anti-stale)", set1 != set2,
                          f"{args.data}: {sorted(set1)[:5]} vs {d2}: {sorted(set2)[:5]}")
            except Exception as e:
                regra("R7", "precos variam entre datas (anti-stale)", "SKIP",
                      f"consulta de controle ({d2}) falhou, sem evidencia de stale: {e}")

        # R8 consistencia: repetir a mesma consulta
        time.sleep(5)  # espaco entre consultas: evita falso-negativo por rate limit
        try:
            r3 = consulta(args.origem, args.destino, args.data, args.volta, args.moeda)
            m1, m3 = r["preco_minimo"], r3["preco_minimo"]
            ok = m1 and m3 and abs(m1 - m3) / m1 < 0.25
            regra("R8", "repeticao da consulta estavel (<25%)", bool(ok), f"{m1} vs {m3}")
        except Exception as e:
            regra("R8", "repeticao da consulta estavel (<25%)", False, str(e))

    falhas = [c for c, _, ok, _ in resultados if ok != "SKIP" and not ok]
    pulados = [c for c, _, ok, _ in resultados if ok == "SKIP"]
    avaliadas = len(resultados) - len(pulados)
    print(f"\nRESULTADO: {avaliadas - len(falhas)}/{avaliadas} regras passaram"
          + (f" ({len(pulados)} SKIP: {', '.join(pulados)})" if pulados else "")
          + (f" — FALHOU: {', '.join(falhas)}" if falhas else " — tudo OK"))
    tipo = (r.get("consulta") or {}).get("tipo", "?")
    print(f"preco minimo {tipo}: {r.get('preco_minimo')} {args.moeda}"
          f" | por cia: {r.get('preco_minimo_por_cia')}")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
