"""
Popula o sistema com dados de DEMONSTRAÇÃO, para apresentar os gráficos ao cliente.

    python seed_demo.py            # insere os dados de demonstração
    python seed_demo.py --limpar   # remove TODOS os dados de demonstração

Os registros criados aqui ficam marcados no campo "observações" com a etiqueta
MARCADOR abaixo. A limpeza remove apenas os registros com essa marca — dados
reais digitados pelo cliente nunca são afetados.

Em produção (Railway), rode pelo console do serviço; ele usa a mesma DATABASE_URL
da aplicação.
"""

import sys
import json
from datetime import date

from app import app, db, Colaborador, Emprestimo, Lancamento

MARCADOR = '[DEMONSTRACAO] Registro fictício para apresentação.'


def meses_recentes(qtd=6):
    """Últimos `qtd` meses terminando no mês atual, no formato YYYY-MM."""
    hoje = date.today()
    ano, mes = hoje.year, hoje.month
    saida = []
    for _ in range(qtd):
        saida.append(f'{ano:04d}-{mes:02d}')
        mes -= 1
        if mes == 0:
            mes, ano = 12, ano - 1
    return list(reversed(saida))


# nome, cpf, empresa, contratação, remuneração, prêmio, valor da diária
PESSOAS = [
    ('Ana Souza',      '111.222.333-01', 'Engenharia',   'CLT',        4200.0, 300.0, 0.0),
    ('Bruno Lima',     '111.222.333-02', 'Engenharia',   'Diarista',      0.0,   0.0, 180.0),
    ('Carla Dias',     '111.222.333-03', 'Engenharia',   'Mensalista', 2800.0,   0.0, 0.0),
    ('Felipe Rocha',   '111.222.333-04', 'Engenharia',   'CLT',        3900.0, 200.0, 0.0),
    ('Diego Alves',    '111.222.333-05', 'Gerenciadora', 'CLT',        6500.0, 500.0, 0.0),
    ('Elis Moura',     '111.222.333-06', 'Gerenciadora', 'CLT',        5100.0,   0.0, 0.0),
]

# Meses (índice dentro da lista de meses) em que cada pessoa sai de férias
FERIAS = {
    'Ana Souza': [1],
    'Diego Alves': [3],
    'Carla Dias': [4],
    'Bruno Lima': [5],
}


def limpar():
    with app.app_context():
        alvos = Colaborador.query.filter(Colaborador.observacoes == MARCADOR).all()
        if not alvos:
            print('Nenhum dado de demonstração encontrado.')
            return
        for c in alvos:
            db.session.delete(c)  # cascade remove lançamentos e empréstimos
        db.session.commit()
        print(f'{len(alvos)} colaborador(es) de demonstração removido(s), '
              f'junto com seus lançamentos e empréstimos.')


def semear():
    with app.app_context():
        if Colaborador.query.filter(Colaborador.observacoes == MARCADOR).first():
            print('Os dados de demonstração já existem. Rode com --limpar antes de recriar.')
            return

        meses = meses_recentes(6)
        base_id = 900000000000

        for i, (nome, cpf, empresa, contratacao, remun, premio, diaria) in enumerate(PESSOAS):
            if Colaborador.query.filter_by(cpf=cpf).first():
                print(f'CPF {cpf} já existe — pulando {nome}.')
                continue

            colab_id = str(base_id + i)
            colaborador = Colaborador(
                id=colab_id, nome=nome, cpf=cpf, empresa=empresa,
                contratacao=contratacao, endereco='Rua Exemplo, 100',
                funcao='Operacional', admissao=f'{meses[0]}-01',
                remuneracao=remun, premio=premio, valorDiaria=diaria,
                total=remun + premio,
                valeRefeicao='Sim', valeTransporte='Sim', seguroVida='Ativo',
                planoOdonto='Não', dependentes=0,
                temAdiantamento='Sim', valorAdiantamento=round((remun or diaria * 20) * 0.10, 2),
                tipoAdiantamento='Espécie', observacoes=MARCADOR,
            )
            db.session.add(colaborador)
            db.session.flush()

            # Um empréstimo para a primeira pessoa, começando 3 meses atrás
            emprestimo_id = None
            if nome == 'Ana Souza':
                emprestimo_id = str(base_id + 500 + i)
                db.session.add(Emprestimo(
                    id=emprestimo_id, colaborador_id=colab_id, valor=1200.0,
                    parcelas=6, inicio=meses[2], descricao='Notebook',
                ))

            for idx, mes in enumerate(meses):
                em_ferias = idx in FERIAS.get(nome, [])

                if em_ferias:
                    db.session.add(Lancamento(
                        id=f'{colab_id}{idx:02d}', colaboradorId=colab_id, mes=mes,
                        ferias='Férias', diasTrabalhados=0,
                        remuneracao=0, bonificacao=0, totalRecebido=0,
                        adiantamentoEspecie=0, adiantamentoContab=0, horasExtras=0,
                        valeTransporte=0, emprestimo=0, outros=0, liquidoTotal=0,
                        pagamentoContab=0, pagamentoEspecie=0,
                        formaPagamento='Depósito', emprestimosPagos=json.dumps([]),
                        status='finalizado',
                    ))
                    continue

                dias = 22 if contratacao == 'Diarista' else 0
                bruto = diaria * dias if contratacao == 'Diarista' else remun
                horas_extras = round(bruto * (0.04 + 0.01 * (idx % 3)), 2)
                adiantamento = round(bruto * 0.10, 2)
                vale_transporte = round(bruto * 0.03, 2)

                # Parcela do empréstimo nos meses em que ele está ativo
                parcela, pagos = 0.0, []
                if emprestimo_id and idx >= 2:
                    parcela = 200.0
                    pagos = [{'id': emprestimo_id, 'valor': parcela}]

                total_recebido = bruto + premio
                liquido = total_recebido + horas_extras - vale_transporte - parcela - adiantamento

                db.session.add(Lancamento(
                    id=f'{colab_id}{idx:02d}', colaboradorId=colab_id, mes=mes,
                    ferias='Normal', diasTrabalhados=dias,
                    remuneracao=bruto, bonificacao=premio, totalRecebido=total_recebido,
                    adiantamentoEspecie=adiantamento, adiantamentoContab=0,
                    horasExtras=horas_extras, valeTransporte=vale_transporte,
                    emprestimo=parcela, outros=0, liquidoTotal=liquido,
                    pagamentoContab=round(liquido * 0.5, 2),
                    pagamentoEspecie=round(liquido * 0.5, 2),
                    formaPagamento='Depósito + Espécie',
                    emprestimosPagos=json.dumps(pagos),
                    status='finalizado',
                ))

        db.session.commit()
        print(f'Dados de demonstração criados: {len(PESSOAS)} colaboradores '
              f'e lançamentos de {meses[0]} a {meses[-1]}.')
        print('Para remover depois: python seed_demo.py --limpar')


if __name__ == '__main__':
    if '--limpar' in sys.argv:
        limpar()
    else:
        semear()
