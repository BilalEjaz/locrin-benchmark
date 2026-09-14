#!/usr/bin/env python3
"""Spike go/no-go: mede a cobertura do cache Aviasales em rotas BR.

Gate do design 2026-07-23 (registrado no historico do repo): a fonte aviasales-cache
so entra no fluxo da skill se o cache tiver densidade util em rotas BR.

Uso:
  spike_aviasales.py                # mes que vem, rotas padrao
  spike_aviasales.py --mes 2026-09

Criterio: GO se ALGUMA rota tiver preco em >=50%% dos dias do mes;
NO-GO se todas ficarem abaixo (dai reavaliar plano B: SerpAPI/Duffel).
Se NENHUMA rota respondeu (rede fora, token invalido/401), o veredicto e
INDETERMINADO — nao da para concluir NO-GO sem dado.
Exit 0 = GO, 1 = NO-GO, 3 = sem token, 4 = INDETERMINADO.
"""
import argparse
import calendar
import datetime as dtmod
import json
import os
import sys
import time

API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"
ROTAS = [("BSB", "CGH"), ("BSB", "MAD"), ("GRU", "MAD")]
CORTE = 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mes", default=None, help="YYYY-MM (default: mes que vem)")
    args = ap.parse_args()

    token = os.environ.get("TRAVELPAYOUTS_TOKEN")
    if not token:
        print(json.dumps({"erro": "TRAVELPAYOUTS_TOKEN ausente - veja fonte_aviasales.py"}))
        sys.exit(3)

    if args.mes:
        mes = args.mes
    else:
        hoje = dtmod.date.today()
        prox = (hoje.replace(day=1) + dtmod.timedelta(days=32)).replace(day=1)
        mes = prox.strftime("%Y-%m")
    ano, mnum = int(mes[:4]), int(mes[5:7])
    dias_no_mes = calendar.monthrange(ano, mnum)[1]

    import requests

    resultados, alguma_go, sucessos = [], False, 0
    for origem, destino in ROTAS:
        try:
            r = requests.get(API, params={
                "origin": origem, "destination": destino, "departure_at": mes,
                "currency": "brl", "sorting": "price", "limit": 1000,
                "unique": "false", "one_way": "true", "token": token,
            }, timeout=30)
            r.raise_for_status()
            corpo = r.json()
            itens = corpo.get("data") or []
            dias = {(it.get("departure_at") or "")[:10] for it in itens if it.get("price")}
            dias.discard("")
            cobertura = len(dias) / dias_no_mes
            go = cobertura >= CORTE
            alguma_go = alguma_go or go
            sucessos += 1
            resultados.append({
                "rota": f"{origem}-{destino}", "mes": mes,
                "dias_com_preco": len(dias), "dias_no_mes": dias_no_mes,
                "cobertura": round(cobertura, 2), "ok": go,
                "preco_minimo_visto": min((it["price"] for it in itens if it.get("price")), default=None),
            })
        except Exception as e:
            resultados.append({"rota": f"{origem}-{destino}", "erro": f"{type(e).__name__}: {e}"})
        time.sleep(0.5)

    # nenhuma rota respondeu = falta de dado, nao evidencia contra o cache
    if sucessos == 0:
        veredicto = "INDETERMINADO"
    else:
        veredicto = "GO" if alguma_go else "NO-GO"
    print(json.dumps({
        "veredicto": veredicto,
        "criterio": f"GO se alguma rota com cobertura >= {int(CORTE * 100)}% dos dias de {mes}",
        "rotas_ok": sucessos,
        "rotas_com_erro": len(resultados) - sucessos,
        "rotas": resultados,
        "proximo_passo": "GO: usar fonte_aviasales.py no fluxo da skill | "
                         "NO-GO: reavaliar plano B (SerpAPI/Duffel) na spec | "
                         "INDETERMINADO: nenhuma rota respondeu (rede/token) — "
                         "corrigir o acesso e repetir o spike",
    }, ensure_ascii=False, indent=1))
    sys.exit(4 if sucessos == 0 else (0 if alguma_go else 1))


if __name__ == "__main__":
    main()
