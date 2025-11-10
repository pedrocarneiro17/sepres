from flask import Flask, jsonify, request, send_from_directory, render_template
from flask_cors import CORS
import json
import os
from datetime import datetime

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')
CORS(app)

DATA_FILE = 'dados.json'

def carregar_dados():
    """Garante que a estrutura padrão seja retornada para prevenir KeyErrors."""
    # Estrutura de dados mínima esperada, caso algo falhe
    dados_padrao = {'colaboradores': [], 'lancamentos': []}
    
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                dados = json.load(f)
                
                # Se o JSON lido for um dicionário, mesclamos para garantir chaves ausentes
                if isinstance(dados, dict):
                    # O operador **dados_padrao garante que 'colaboradores' e 'lancamentos' existam
                    return {**dados_padrao, **dados} 
        
        except (json.JSONDecodeError, FileNotFoundError):
            # Ignora se o arquivo estiver corrompido ou sumir
            pass 
        except Exception as e:
            # Captura erros de I/O ou permissão e não deixa o worker travar
            print(f"AVISO: ERRO ao carregar dados do JSON: {e}")
            pass
            
    # Retorna o padrão em todos os casos de falha na leitura/ausência do arquivo
    return dados_padrao

def salvar_dados(dados):
    """Salva dados no arquivo JSON"""
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)

# ==================== ROTAS API ====================

@app.route('/')
def index():
    """Página inicial"""
    return render_template('index.html')

@app.route('/<path:path>')
def serve_page(path):
    """Servir páginas HTML"""
    if path.endswith('.html'):
        return render_template(path)
    return send_from_directory('static', path)

@app.route('/api/dados', methods=['GET'])
def obter_dados():
    """Retorna todos os dados"""
    dados = carregar_dados()
    return jsonify(dados)

@app.route('/api/colaboradores', methods=['GET'])
def obter_colaboradores():
    """Retorna todos os colaboradores"""
    dados = carregar_dados()
    return jsonify(dados['colaboradores'])

@app.route('/api/colaboradores', methods=['POST'])
def adicionar_colaborador():
    """Adiciona um novo colaborador"""
    dados = carregar_dados()
    novo_colaborador = request.json
    
    # Verificar CPF duplicado
    cpf_existe = any(c['cpf'] == novo_colaborador['cpf'] and c['id'] != novo_colaborador.get('id') 
                     for c in dados['colaboradores'])
    if cpf_existe:
        return jsonify({'erro': 'CPF já cadastrado!'}), 400
    
    # Se tem ID, é edição
    if 'id' in novo_colaborador and novo_colaborador['id']:
        # Atualizar colaborador existente
        for i, c in enumerate(dados['colaboradores']):
            if c['id'] == novo_colaborador['id']:
                dados['colaboradores'][i] = novo_colaborador
                break
    else:
        # Adicionar novo colaborador
        novo_colaborador['id'] = str(int(datetime.now().timestamp() * 1000))
        dados['colaboradores'].append(novo_colaborador)
    
    salvar_dados(dados)
    return jsonify(novo_colaborador), 201

@app.route('/api/colaboradores/<id>', methods=['DELETE'])
def excluir_colaborador(id):
    """Exclui um colaborador e seus lançamentos"""
    dados = carregar_dados()
    
    # Remover colaborador
    dados['colaboradores'] = [c for c in dados['colaboradores'] if c['id'] != id]
    
    # Remover lançamentos do colaborador
    dados['lancamentos'] = [l for l in dados['lancamentos'] if l['colaboradorId'] != id]
    
    salvar_dados(dados)
    return jsonify({'mensagem': 'Colaborador excluído com sucesso'}), 200

@app.route('/api/lancamentos', methods=['GET'])
def obter_lancamentos():
    """Retorna todos os lançamentos"""
    dados = carregar_dados()
    return jsonify(dados['lancamentos'])

@app.route('/api/lancamentos', methods=['POST'])
def adicionar_lancamento():
    """Adiciona um novo lançamento"""
    dados = carregar_dados()
    novo_lancamento = request.json
    
    # Se tem ID, é edição
    if 'id' in novo_lancamento and novo_lancamento['id']:
        # Atualizar lançamento existente
        for i, l in enumerate(dados['lancamentos']):
            if l['id'] == novo_lancamento['id']:
                dados['lancamentos'][i] = novo_lancamento
                break
    else:
        # Adicionar novo lançamento
        novo_lancamento['id'] = str(int(datetime.now().timestamp() * 1000))
        dados['lancamentos'].append(novo_lancamento)
    
    salvar_dados(dados)
    return jsonify(novo_lancamento), 201

@app.route('/api/lancamentos/<id>', methods=['DELETE'])
def excluir_lancamento(id):
    """Exclui um lançamento"""
    dados = carregar_dados()
    dados['lancamentos'] = [l for l in dados['lancamentos'] if l['id'] != id]
    salvar_dados(dados)
    return jsonify({'mensagem': 'Lançamento excluído com sucesso'}), 200

@app.route('/api/lancamentos/<id>/finalizar', methods=['PUT'])
def finalizar_lancamento(id):
    """Finaliza um lançamento"""
    dados = carregar_dados()
    for l in dados['lancamentos']:
        if l['id'] == id:
            l['status'] = 'finalizado'
            break
    salvar_dados(dados)
    return jsonify({'mensagem': 'Lançamento finalizado'}), 200

@app.route('/api/lancamentos/<id>/reabrir', methods=['PUT'])
def reabrir_lancamento(id):
    """Reabre um lançamento"""
    dados = carregar_dados()
    for l in dados['lancamentos']:
        if l['id'] == id:
            l['status'] = 'aberto'
            break
    salvar_dados(dados)
    return jsonify({'mensagem': 'Lançamento reaberto'}), 200

# ==================== BACKUP ====================

@app.route('/api/backup', methods=['GET'])
def fazer_backup():
    """Retorna os dados para backup"""
    dados = carregar_dados()
    return jsonify(dados)

@app.route('/api/restaurar', methods=['POST'])
def restaurar_backup():
    """Restaura dados de um backup"""
    dados = request.json
    salvar_dados(dados)
    return jsonify({'mensagem': 'Backup restaurado com sucesso'}), 200

if __name__ == '__main__':
    # Criar pasta static se não existir
    if not os.path.exists('static'):
        os.makedirs('static')
    
    app.run(debug=True, host='0.0.0.0', port=5000)