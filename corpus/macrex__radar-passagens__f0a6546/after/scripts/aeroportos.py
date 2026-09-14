#!/usr/bin/env python3
"""Resolve cidade -> aeroportos (Brasil + principais destinos).

Uso:
  aeroportos.py "sao paulo"   -> JSON com os aeroportos da cidade
  aeroportos.py rio           -> prefixo/palavra: "rio de janeiro" (SDU+GIG)
  aeroportos.py GRU           -> JSON com o aeroporto do codigo

Ordem de resolucao (CIDADE PRIMEIRO, codigo IATA depois):
  1. nome exato da cidade ("sao paulo");
  2. prefixo da cidade OU de uma palavra dela, com >= 3 letras
     ("rio" -> rio de janeiro, "por" -> porto alegre). Entradas com menos de
     3 letras nao geram match por prefixo (evita "na" -> campinas);
  3. se o passo 2 achar MAIS DE UMA cidade (ex.: "bel" -> belem e belo
     horizonte), devolve {"candidatas": [...], "erro": "ambiguo ..."} para o
     agente perguntar ao usuario — nunca escolhe sozinho;
  4. so entao, se a entrada tem 3 letras, e tratada como codigo IATA.

Cidades com MAIS DE UM aeroporto exigem escolha do usuario (ou "todos")
antes da busca — ver protocolo no SKILL.md.

Saida: {"cidade", "aeroportos", "multi"} nos casos resolvidos; com "erro"
(e "candidatas", quando ambiguo) nos casos que exigem confirmacao; e com
"aviso" quando o codigo IATA nao esta no catalogo (segue utilizavel).
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


MIN_PREFIXO = 3  # abaixo disso o prefixo e ambiguo demais ("na", "sa", "po")


def _achado(cidade, aps):
    return {"cidade": cidade, "aeroportos": aps, "multi": len(aps) > 1}


def candidatas_cidade(e: str):
    """Cidades cujo nome (ou uma palavra dele) comeca com 'e'. Exige >= 3
    letras: prefixo/palavra, NUNCA substring solta (que faria "na" casar com
    campinas e resolver a cidade errada em silencio)."""
    if len(e) < MIN_PREFIXO:
        return []
    return [(cidade, aps) for cidade, aps in CIDADES.items()
            if cidade.startswith(e) or any(w.startswith(e) for w in cidade.split())]


def resolve(entrada: str):
    e = norm(entrada)

    # 1) cidade PRIMEIRO — senao "rio"/"sao"/"por" viravam codigos IATA
    #    inexistentes e o protocolo multi-aeroporto era pulado em silencio
    for cidade, aps in CIDADES.items():
        if e == cidade:
            return _achado(cidade, aps)

    cands = candidatas_cidade(e)
    if len(cands) == 1:
        return _achado(*cands[0])
    if len(cands) > 1:
        return {
            "cidade": None,
            "aeroportos": [],
            "multi": False,
            "candidatas": [{"cidade": c, "aeroportos": aps} for c, aps in cands],
            "erro": f"'{entrada}' e ambiguo — confirmar cidade com o usuario "
                    f"({', '.join(c for c, _ in cands)})",
        }

    # 2) so agora: codigo IATA
    if len(e) == 3 and e.isalpha():
        code = e.upper()
        for cidade, aps in CIDADES.items():
            for a in aps:
                if a["code"] == code:
                    return {"cidade": cidade, "aeroportos": [a], "multi": False}
        return {"cidade": None,
                "aeroportos": [{"code": code, "nome": code, "obs": "codigo nao catalogado"}],
                "multi": False,
                "aviso": f"'{code}' nao esta no catalogo — sera usado como codigo IATA; "
                         f"confirmar com o usuario se era isso mesmo"}

    return {"cidade": None, "aeroportos": [], "multi": False,
            "erro": f"cidade '{entrada}' nao catalogada — pedir codigo IATA ao usuario"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"erro": "uso: aeroportos.py <cidade|IATA>"}))
        sys.exit(1)
    print(json.dumps(resolve(" ".join(sys.argv[1:])), ensure_ascii=False, indent=1))
