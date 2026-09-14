#!/usr/bin/env python3
"""Resolve cidade -> aeroportos (Brasil + principais destinos).

Uso:
  aeroportos.py "sao paulo"   -> JSON com os aeroportos da cidade
  aeroportos.py GRU           -> JSON com o aeroporto do codigo

Cidades com MAIS DE UM aeroporto exigem escolha do usuario (ou "todos")
antes da busca — ver protocolo no SKILL.md.
"""
import json
import sys
import unicodedata

CIDADES = {
    "sao paulo": [
        {"code": "CGH", "nome": "Congonhas", "obs": "na cidade, so domesticos"},
        {"code": "GRU", "nome": "Guarulhos", "obs": "internacional, ~25km do centro"},
        {"code": "VCP", "nome": "Viracopos (Campinas)", "obs": "~99km de SP, hub Azul, costuma ser o mais barato"},
    ],
    "rio de janeiro": [
        {"code": "SDU", "nome": "Santos Dumont", "obs": "no centro, so domesticos"},
        {"code": "GIG", "nome": "Galeao", "obs": "internacional, ~20km do centro"},
    ],
    "belo horizonte": [
        {"code": "CNF", "nome": "Confins", "obs": "principal, ~40km do centro"},
        {"code": "PLU", "nome": "Pampulha", "obs": "aviacao regional"},
    ],
    "brasilia": [{"code": "BSB", "nome": "JK", "obs": ""}],
    "campinas": [{"code": "VCP", "nome": "Viracopos", "obs": ""}],
    "salvador": [{"code": "SSA", "nome": "Salvador", "obs": ""}],
    "recife": [{"code": "REC", "nome": "Guararapes", "obs": ""}],
    "fortaleza": [{"code": "FOR", "nome": "Pinto Martins", "obs": ""}],
    "porto alegre": [{"code": "POA", "nome": "Salgado Filho", "obs": ""}],
    "curitiba": [{"code": "CWB", "nome": "Afonso Pena", "obs": ""}],
    "florianopolis": [{"code": "FLN", "nome": "Hercilio Luz", "obs": ""}],
    "goiania": [{"code": "GYN", "nome": "Santa Genoveva", "obs": ""}],
    "manaus": [{"code": "MAO", "nome": "Eduardo Gomes", "obs": ""}],
    "belem": [{"code": "BEL", "nome": "Val de Cans", "obs": ""}],
    "vitoria": [{"code": "VIX", "nome": "Eurico Salles", "obs": ""}],
    "natal": [{"code": "NAT", "nome": "Sao Goncalo do Amarante", "obs": ""}],
    "maceio": [{"code": "MCZ", "nome": "Zumbi dos Palmares", "obs": ""}],
    "buenos aires": [
        {"code": "AEP", "nome": "Aeroparque", "obs": "na cidade"},
        {"code": "EZE", "nome": "Ezeiza", "obs": "internacional, ~30km"},
    ],
    "nova york": [
        {"code": "JFK", "nome": "JFK", "obs": ""},
        {"code": "EWR", "nome": "Newark", "obs": ""},
        {"code": "LGA", "nome": "LaGuardia", "obs": "so domesticos EUA"},
    ],
    "londres": [
        {"code": "LHR", "nome": "Heathrow", "obs": ""},
        {"code": "LGW", "nome": "Gatwick", "obs": ""},
        {"code": "STN", "nome": "Stansted", "obs": "low-cost"},
    ],
    "lisboa": [{"code": "LIS", "nome": "Humberto Delgado", "obs": ""}],
    "paris": [
        {"code": "CDG", "nome": "Charles de Gaulle", "obs": ""},
        {"code": "ORY", "nome": "Orly", "obs": ""},
    ],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower().strip())
    return "".join(c for c in s if not unicodedata.combining(c))


def resolve(entrada: str):
    e = norm(entrada)
    if len(e) == 3 and e.isalpha():  # ja e codigo IATA
        code = e.upper()
        for cidade, aps in CIDADES.items():
            for a in aps:
                if a["code"] == code:
                    return {"cidade": cidade, "aeroportos": [a], "multi": False}
        return {"cidade": None, "aeroportos": [{"code": code, "nome": code, "obs": "codigo nao catalogado"}], "multi": False}
    for cidade, aps in CIDADES.items():
        if e == cidade or e in cidade:
            return {"cidade": cidade, "aeroportos": aps, "multi": len(aps) > 1}
    return {"cidade": None, "aeroportos": [], "multi": False,
            "erro": f"cidade '{entrada}' nao catalogada — pedir codigo IATA ao usuario"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"erro": "uso: aeroportos.py <cidade|IATA>"}))
        sys.exit(1)
    print(json.dumps(resolve(" ".join(sys.argv[1:])), ensure_ascii=False, indent=1))
