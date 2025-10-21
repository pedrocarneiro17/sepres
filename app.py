# app.py - Backend Flask para Sistema de Departamento Pessoal

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import json
import os

app = Flask(__name__)
CORS(app)

# Simulando banco de dados com arquivos JSON
DATA_DIR = 'data'
COLABORADORES_FILE = os.path.join(DATA_DIR, 'colaboradores.json')
LANCAMENTOS_FILE = os.path.join(DATA_DIR, 'lancamentos.json')

# Criar diretório de dados se não existir
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

# Funções auxiliares para carregar e salvar dados
def carregar_dados(arquivo):
    if os.path.exists(arquivo):
        with open(arquivo, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def salvar_dados(arquivo, dados):
    with open(arquivo, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)

# ==================== ROTAS DE COLABORADORES ====================

@app.route('/api/colaboradores', methods=['GET'])
def listar_colaboradores():
    """Lista todos os colaboradores"""
    colaboradores = carregar_dados(COLABORADORES_FILE)
    return jsonify(colaboradores)

@app.route('/api/colaboradores/<id>', methods=['GET'])
def obter_colaborador(id):
    """Obtém um colaborador específico"""
    colaboradores = carregar_dados(COLABORADORES_FILE)
    colaborador = next((c for c in colaboradores if c['id'] == id), None)
    
    if colaborador:
        return jsonify(colaborador)
    return jsonify({'erro': 'Colaborador não encontrado'}), 404

@app.route('/api/colaboradores', methods=['POST'])
def criar_colaborador():
    """Cria um novo colaborador"""
    dados = request.json
    colaboradores = carregar_dados(COLABORADORES_FILE)
    
    # Validar CPF duplicado
    cpf_existe = any(c['cpf'] == dados['cpf'] for c in colaboradores)
    if cpf_existe:
        return jsonify({'erro': 'CPF já cadastrado'}), 400
    
    # Gerar ID único
    novo_id = str(max([int(c['id']) for c in colaboradores], default=0) + 1)
    
    colaborador = {
        'id': novo_id,
        'nome': dados['nome'],
        'cpf': dados['cpf'],
        'endereco': dados.get('endereco', ''),
        'funcao': dados.get('funcao', ''),
        'contratacao': dados.get('contratacao', 'CLT'),
        'valeRefeicao': dados.get('valeRefeicao', 'Não'),
        'valeTransporte': dados.get('valeTransporte', 'Não'),
        'seguroVida': dados.get('seguroVida', 'Inativo'),
        'observacoes': dados.get('observacoes', ''),
        'dataCadastro': datetime.now().isoformat()
    }
    
    colaboradores.append(colaborador)
    salvar_dados(COLABORADORES_FILE, colaboradores)
    
    return jsonify(colaborador), 201

@app.route('/api/colaboradores/<id>', methods=['PUT'])
def atualizar_colaborador(id):
    """Atualiza um colaborador existente"""
    dados = request.json
    colaboradores = carregar_dados(COLABORADORES_FILE)
    
    index = next((i for i, c in enumerate(colaboradores) if c['id'] == id), None)
    
    if index is None:
        return jsonify({'erro': 'Colaborador não encontrado'}), 404
    
    # Validar CPF duplicado (exceto o próprio)
    cpf_existe = any(c['cpf'] == dados['cpf'] and c['id'] != id for c in colaboradores)
    if cpf_existe:
        return jsonify({'erro': 'CPF já cadastrado para outro colaborador'}), 400
    
    colaboradores[index].update({
        'nome': dados['nome'],
        'cpf': dados['cpf'],
        'endereco': dados.get('endereco', ''),
        'funcao': dados.get('funcao', ''),
        'contratacao': dados.get('contratacao', 'CLT'),
        'valeRefeicao': dados.get('valeRefeicao', 'Não'),
        'valeTransporte': dados.get('valeTransporte', 'Não'),
        'seguroVida': dados.get('seguroVida', 'Inativo'),
        'observacoes': dados.get('observacoes', ''),
        'dataAtualizacao': datetime.now().isoformat()
    })
    
    salvar_dados(COLABORADORES_FILE, colaboradores)
    return jsonify(colaboradores[index])

@app.route('/api/colaboradores/<id>', methods=['DELETE'])
def excluir_colaborador(id):
    """Exclui um colaborador e todos os lançamentos vinculados"""
    colaboradores = carregar_dados(COLABORADORES_FILE)
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    # Remover colaborador
    colaboradores = [c for c in colaboradores if c['id'] != id]
    
    # Remover lançamentos vinculados
    lancamentos_removidos = len([l for l in lancamentos if l['colaboradorId'] == id])
    lancamentos = [l for l in lancamentos if l['colaboradorId'] != id]
    
    salvar_dados(COLABORADORES_FILE, colaboradores)
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    
    return jsonify({
        'mensagem': 'Colaborador excluído com sucesso',
        'lancamentosRemovidos': lancamentos_removidos
    })

# ==================== ROTAS DE LANÇAMENTOS ====================

@app.route('/api/lancamentos', methods=['GET'])
def listar_lancamentos():
    """Lista todos os lançamentos com filtros opcionais"""
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    colaboradores = carregar_dados(COLABORADORES_FILE)
    
    # Filtros opcionais
    mes = request.args.get('mes')
    colaborador_id = request.args.get('colaboradorId')
    status = request.args.get('status')
    
    # Aplicar filtros
    if mes:
        lancamentos = [l for l in lancamentos if l['mes'] == mes]
    if colaborador_id:
        lancamentos = [l for l in lancamentos if l['colaboradorId'] == colaborador_id]
    if status:
        lancamentos = [l for l in lancamentos if l['status'] == status]
    
    # Enriquecer com dados do colaborador
    for lanc in lancamentos:
        colab = next((c for c in colaboradores if c['id'] == lanc['colaboradorId']), None)
        if colab:
            lanc['colaboradorNome'] = colab['nome']
            lanc['colaboradorCPF'] = colab['cpf']
    
    return jsonify(lancamentos)

@app.route('/api/lancamentos/<id>', methods=['GET'])
def obter_lancamento(id):
    """Obtém um lançamento específico"""
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    lancamento = next((l for l in lancamentos if l['id'] == id), None)
    
    if lancamento:
        return jsonify(lancamento)
    return jsonify({'erro': 'Lançamento não encontrado'}), 404

@app.route('/api/lancamentos', methods=['POST'])
def criar_lancamento():
    """Cria um novo lançamento"""
    dados = request.json
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    # Validar se colaborador existe
    colaboradores = carregar_dados(COLABORADORES_FILE)
    colab_existe = any(c['id'] == dados['colaboradorId'] for c in colaboradores)
    if not colab_existe:
        return jsonify({'erro': 'Colaborador não encontrado'}), 404
    
    # Validar lançamento duplicado
    lanc_existe = any(
        l['colaboradorId'] == dados['colaboradorId'] and l['mes'] == dados['mes']
        for l in lancamentos
    )
    if lanc_existe:
        return jsonify({'erro': 'Já existe lançamento para este colaborador neste mês'}), 400
    
    # Gerar ID único
    novo_id = str(max([int(l['id']) for l in lancamentos], default=0) + 1)
    
    lancamento = {
        'id': novo_id,
        'colaboradorId': dados['colaboradorId'],
        'mes': dados['mes'],
        'remuneracao': float(dados.get('remuneracao', 0)),
        'bonificacao': float(dados.get('bonificacao', 0)),
        'totalRecebido': float(dados.get('totalRecebido', 0)),
        'adiantamento': float(dados.get('adiantamento', 0)),
        'adiantamentoEspecie': float(dados.get('adiantamentoEspecie', 0)),
        'adiantamentoContab': float(dados.get('adiantamentoContab', 0)),
        'formaPagamento': dados.get('formaPagamento', 'PIX'),
        'horasExtras': float(dados.get('horasExtras', 0)),
        'valeTransporte': float(dados.get('valeTransporte', 0)),
        'pagamentoContab': float(dados.get('pagamentoContab', 0)),
        'pagamentoEspecie': float(dados.get('pagamentoEspecie', 0)),
        'liquidoTotal': float(dados.get('liquidoTotal', 0)),
        'status': 'aberto',
        'dataCriacao': datetime.now().isoformat()
    }
    
    lancamentos.append(lancamento)
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    
    return jsonify(lancamento), 201

@app.route('/api/lancamentos/<id>', methods=['PUT'])
def atualizar_lancamento(id):
    """Atualiza um lançamento existente"""
    dados = request.json
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    index = next((i for i, l in enumerate(lancamentos) if l['id'] == id), None)
    
    if index is None:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
    
    lancamento = lancamentos[index]
    
    # Verificar se está finalizado
    if lancamento['status'] == 'finalizado' and not dados.get('reabrir', False):
        return jsonify({'erro': 'Lançamento finalizado. Reabra antes de editar'}), 400
    
    lancamento.update({
        'remuneracao': float(dados.get('remuneracao', 0)),
        'bonificacao': float(dados.get('bonificacao', 0)),
        'totalRecebido': float(dados.get('totalRecebido', 0)),
        'adiantamento': float(dados.get('adiantamento', 0)),
        'adiantamentoEspecie': float(dados.get('adiantamentoEspecie', 0)),
        'adiantamentoContab': float(dados.get('adiantamentoContab', 0)),
        'formaPagamento': dados.get('formaPagamento', 'PIX'),
        'horasExtras': float(dados.get('horasExtras', 0)),
        'valeTransporte': float(dados.get('valeTransporte', 0)),
        'pagamentoContab': float(dados.get('pagamentoContab', 0)),
        'pagamentoEspecie': float(dados.get('pagamentoEspecie', 0)),
        'liquidoTotal': float(dados.get('liquidoTotal', 0)),
        'dataAtualizacao': datetime.now().isoformat()
    })
    
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    return jsonify(lancamento)

@app.route('/api/lancamentos/<id>/finalizar', methods=['POST'])
def finalizar_lancamento(id):
    """Finaliza um lançamento"""
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    index = next((i for i, l in enumerate(lancamentos) if l['id'] == id), None)
    
    if index is None:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
    
    lancamentos[index]['status'] = 'finalizado'
    lancamentos[index]['dataFinalizacao'] = datetime.now().isoformat()
    
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    return jsonify(lancamentos[index])

@app.route('/api/lancamentos/<id>/reabrir', methods=['POST'])
def reabrir_lancamento(id):
    """Reabre um lançamento finalizado"""
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    index = next((i for i, l in enumerate(lancamentos) if l['id'] == id), None)
    
    if index is None:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
    
    lancamentos[index]['status'] = 'aberto'
    lancamentos[index]['dataReabertura'] = datetime.now().isoformat()
    
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    return jsonify(lancamentos[index])

@app.route('/api/lancamentos/<id>', methods=['DELETE'])
def excluir_lancamento(id):
    """Exclui um lançamento"""
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    lancamentos = [l for l in lancamentos if l['id'] != id]
    
    salvar_dados(LANCAMENTOS_FILE, lancamentos)
    return jsonify({'mensagem': 'Lançamento excluído com sucesso'})

# ==================== ROTAS DE RELATÓRIOS ====================

@app.route('/api/relatorios/dashboard', methods=['GET'])
def dashboard():
    """Retorna estatísticas para o dashboard"""
    colaboradores = carregar_dados(COLABORADORES_FILE)
    lancamentos = carregar_dados(LANCAMENTOS_FILE)
    
    total_colaboradores = len(colaboradores)
    lancamentos_abertos = len([l for l in lancamentos if l['status'] == 'aberto'])
    lancamentos_finalizados = len([l for l in lancamentos if l['status'] == 'finalizado'])
    
    # Total pago no mês atual
    mes_atual = datetime.now().strftime('%Y-%m')
    lancamentos_mes = [l for l in lancamentos if l['mes'] == mes_atual]
    total_mes = sum(l['liquidoTotal'] for l in lancamentos_mes)
    
    return jsonify({
        'totalColaboradores': total_colaboradores,
        'lancamentosAbertos': lancamentos_abertos,
        'lancamentosFinalizados': lancamentos_finalizados,
        'totalPagoMesAtual': total_mes,
        'mesAtual': mes_atual
    })

# ==================== ROTA PRINCIPAL ====================

@app.route('/')
def index():
    """Página inicial - serve o frontend"""
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)