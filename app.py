from flask import Flask, jsonify, request, send_from_directory, render_template
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import json
import os
from datetime import datetime

# ==================== CONFIGURAÇÃO ====================

# Configuração do caminho do banco de dados SQLite
# IMPORTANTE: Em ambientes de contêiner como Railway, os dados ainda serão efêmeros.
DB_FILE = 'dados.db'
basedir = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')
CORS(app)

# Configuração do SQLAlchemy para usar SQLite
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, DB_FILE)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False # Recomendado para desativar avisos
db = SQLAlchemy(app)

# ==================== MODELOS (Estrutura do BD) ====================

class Colaborador(db.Model):
    # Tabela principal para dados do colaborador
    id = db.Column(db.String(50), primary_key=True)
    nome = db.Column(db.String(100), nullable=False)
    cpf = db.Column(db.String(14), unique=True, nullable=False)
    endereco = db.Column(db.String(255))
    funcao = db.Column(db.String(50))
    contratacao = db.Column(db.String(50))
    admissao = db.Column(db.String(10)) # Data YYYY-MM-DD
    remuneracao = db.Column(db.Float)
    premio = db.Column(db.Float)
    total = db.Column(db.Float)
    valeRefeicao = db.Column(db.String(3))
    valeTransporte = db.Column(db.String(3))
    seguroVida = db.Column(db.String(3))
    planoOdonto = db.Column(db.String(3))
    dependentes = db.Column(db.Integer)
    temAdiantamento = db.Column(db.String(3))
    valorAdiantamento = db.Column(db.Float)
    tipoAdiantamento = db.Column(db.String(50))
    observacoes = db.Column(db.Text)
    
    # Relacionamentos
    lancamentos_rel = db.relationship('Lancamento', backref='colaborador', lazy=True, cascade="all, delete-orphan")
    emprestimos_rel = db.relationship('Emprestimo', backref='colaborador', lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        """Converte objeto Colaborador para dicionário (incluindo empréstimos)"""
        # Carrega empréstimos relacionados ao colaborador
        emprestimos_data = [e.to_dict() for e in self.emprestimos_rel]
        
        return {
            "id": self.id,
            "nome": self.nome,
            "cpf": self.cpf,
            "endereco": self.endereco,
            "funcao": self.funcao,
            "contratacao": self.contratacao,
            "admissao": self.admissao,
            "remuneracao": self.remuneracao,
            "premio": self.premio,
            "total": self.total,
            "valeRefeicao": self.valeRefeicao,
            "valeTransporte": self.valeTransporte,
            "seguroVida": self.seguroVida,
            "planoOdonto": self.planoOdonto,
            "dependentes": self.dependentes,
            "temAdiantamento": self.temAdiantamento,
            "valorAdiantamento": self.valorAdiantamento,
            "tipoAdiantamento": self.tipoAdiantamento,
            "observacoes": self.observacoes,
            "emprestimos": emprestimos_data # Adiciona os empréstimos
        }

class Emprestimo(db.Model):
    # Tabela para empréstimos vinculados a um colaborador
    id = db.Column(db.String(50), primary_key=True)
    colaborador_id = db.Column(db.String(50), db.ForeignKey('colaborador.id'), nullable=False)
    valor = db.Column(db.Float)
    parcelas = db.Column(db.Integer)
    inicio = db.Column(db.String(10)) # Data YYYY-MM-DD
    descricao = db.Column(db.String(255))
    
    def to_dict(self):
        """Converte objeto Empréstimo para dicionário"""
        return {
            "id": self.id,
            "valor": self.valor,
            "parcelas": self.parcelas,
            "inicio": self.inicio,
            "descricao": self.descricao,
            "colaboradorId": self.colaborador_id
        }

class Lancamento(db.Model):
    # Tabela para lançamentos mensais
    id = db.Column(db.String(50), primary_key=True)
    colaboradorId = db.Column(db.String(50), db.ForeignKey('colaborador.id'), nullable=False)
    mes = db.Column(db.String(7), nullable=False) # YYYY-MM
    ferias = db.Column(db.String(50))
    remuneracao = db.Column(db.Float)
    bonificacao = db.Column(db.Float)
    totalRecebido = db.Column(db.Float)
    adiantamentoEspecie = db.Column(db.Float)
    adiantamentoContab = db.Column(db.Float)
    horasExtras = db.Column(db.Float)
    valeTransporte = db.Column(db.Float)
    emprestimo = db.Column(db.Float)
    outros = db.Column(db.Float)
    liquidoTotal = db.Column(db.Float)
    pagamentoContab = db.Column(db.Float)
    pagamentoEspecie = db.Column(db.Float)
    status = db.Column(db.String(20), default='aberto') # 'aberto' ou 'finalizado'

    def to_dict(self):
        """Converte objeto Lancamento para dicionário"""
        return {
            "id": self.id,
            "colaboradorId": self.colaboradorId,
            "mes": self.mes,
            "ferias": self.ferias,
            "remuneracao": self.remuneracao,
            "bonificacao": self.bonificacao,
            "totalRecebido": self.totalRecebido,
            "adiantamentoEspecie": self.adiantamentoEspecie,
            "adiantamentoContab": self.adiantamentoContab,
            "horasExtras": self.horasExtras,
            "valeTransporte": self.valeTransporte,
            "emprestimo": self.emprestimo,
            "outros": self.outros,
            "liquidoTotal": self.liquidoTotal,
            "pagamentoContab": self.pagamentoContab,
            "pagamentoEspecie": self.pagamentoEspecie,
            "status": self.status
        }

# ==================== FUNÇÃO DE SETUP DO BD ====================

# Cria as tabelas se elas não existirem no arquivo SQLite
with app.app_context():
    db.create_all()

# ==================== FUNÇÕES UTILITÁRIAS ====================

def update_or_create_emprestimos(colaborador_id, emprestimos_data):
    """Atualiza ou cria empréstimos para um colaborador."""
    existing_ids = {e.id for e in Colaborador.query.get(colaborador_id).emprestimos_rel}
    received_ids = {str(e.get('id')) for e in emprestimos_data if e.get('id')}

    # 1. Remover empréstimos que não foram enviados no novo POST
    ids_to_delete = existing_ids - received_ids
    if ids_to_delete:
        Emprestimo.query.filter(Emprestimo.id.in_(ids_to_delete)).delete(synchronize_session='fetch')
    
    # 2. Criar ou atualizar os recebidos
    for emp_data in emprestimos_data:
        emp_id = str(emp_data.get('id')) if emp_data.get('id') else None
        
        if emp_id and emp_id in existing_ids:
            # Atualizar
            emprestimo = Emprestimo.query.get(emp_id)
            if emprestimo:
                emprestimo.valor = emp_data.get('valor', emprestimo.valor)
                emprestimo.parcelas = emp_data.get('parcelas', emprestimo.parcelas)
                emprestimo.inicio = emp_data.get('inicio', emprestimo.inicio)
                emprestimo.descricao = emp_data.get('descricao', emprestimo.descricao)
        else:
            # Criar novo
            # Usando datetime e os.urandom para garantir IDs únicos e não sequenciais
            new_id = str(int(datetime.now().timestamp() * 1000) + int(os.urandom(2).hex(), 16))
            novo_emprestimo = Emprestimo(
                id=new_id,
                colaborador_id=colaborador_id,
                valor=emp_data.get('valor', 0),
                parcelas=emp_data.get('parcelas', 1),
                inicio=emp_data.get('inicio', ''),
                descricao=emp_data.get('descricao', 'Sem descrição')
            )
            db.session.add(novo_emprestimo)

# ==================== ROTAS DE SERVIÇO (HTML/STATIC) ====================

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

# ==================== ROTAS API (USANDO SQLAlchemy) ====================

@app.route('/api/dados', methods=['GET'])
def obter_dados():
    """Retorna todos os dados de uma vez (Colaboradores e Lançamentos)"""
    colaboradores_list = Colaborador.query.all()
    lancamentos_list = Lancamento.query.all()
    
    return jsonify({
        'colaboradores': [c.to_dict() for c in colaboradores_list],
        'lancamentos': [l.to_dict() for l in lancamentos_list]
    })

@app.route('/api/colaboradores', methods=['GET'])
def obter_colaboradores():
    """Retorna todos os colaboradores"""
    colaboradores_list = Colaborador.query.all()
    return jsonify([c.to_dict() for c in colaboradores_list])

@app.route('/api/colaboradores', methods=['POST'])
def adicionar_colaborador():
    """Adiciona/Edita um colaborador"""
    data = request.json
    
    try:
        # 1. Verificar CPF duplicado (excluindo o próprio ID, se for edição)
        cpf_existente = Colaborador.query.filter(
            Colaborador.cpf == data['cpf'], 
            Colaborador.id != data.get('id')
        ).first()
        
        if cpf_existente:
            return jsonify({'erro': 'CPF já cadastrado!'}), 400
        
        # 2. Lógica de Edição
        if data.get('id'):
            colaborador = Colaborador.query.get(data['id'])
            if not colaborador:
                return jsonify({'erro': 'Colaborador não encontrado'}), 404
            
            # Atualiza campos do colaborador
            for key, value in data.items():
                if hasattr(colaborador, key) and key != 'emprestimos':
                    setattr(colaborador, key, value)
            
            # Atualiza empréstimos relacionados
            update_or_create_emprestimos(colaborador.id, data.get('emprestimos', []))
            
        # 3. Lógica de Criação
        else:
            new_id = str(int(datetime.now().timestamp() * 1000))
            colaborador = Colaborador(
                id=new_id,
                nome=data.get('nome', 'Novo Colaborador'),
                cpf=data['cpf'],
                endereco=data.get('endereco'),
                funcao=data.get('funcao'),
                contratacao=data.get('contratacao'),
                admissao=data.get('admissao'),
                remuneracao=data.get('remuneracao', 0),
                premio=data.get('premio', 0),
                total=data.get('total', 0),
                valeRefeicao=data.get('valeRefeicao'),
                valeTransporte=data.get('valeTransporte'),
                seguroVida=data.get('seguroVida'),
                planoOdonto=data.get('planoOdonto'),
                dependentes=data.get('dependentes', 0),
                temAdiantamento=data.get('temAdiantamento'),
                valorAdiantamento=data.get('valorAdiantamento', 0),
                tipoAdiantamento=data.get('tipoAdiantamento'),
                observacoes=data.get('observacoes')
            )
            db.session.add(colaborador)
            db.session.flush() # Obtem o ID antes do commit
            
            # Cria empréstimos (se houver)
            update_or_create_emprestimos(colaborador.id, data.get('emprestimos', []))
            
        db.session.commit()
        return jsonify(colaborador.to_dict()), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"ERRO AO SALVAR COLABORADOR: {e}")
        return jsonify({'erro': 'Erro interno ao salvar colaborador'}), 500

@app.route('/api/colaboradores/<id>', methods=['DELETE'])
def excluir_colaborador(id):
    """Exclui um colaborador e, devido ao cascade, seus lançamentos e empréstimos."""
    colaborador = Colaborador.query.get(id)
    if not colaborador:
        return jsonify({'erro': 'Colaborador não encontrado'}), 404
    
    try:
        db.session.delete(colaborador)
        db.session.commit()
        return jsonify({'mensagem': 'Colaborador excluído com sucesso'}), 200
    except Exception as e:
        db.session.rollback()
        print(f"ERRO AO EXCLUIR COLABORADOR: {e}")
        return jsonify({'erro': 'Erro interno ao excluir colaborador'}), 500

@app.route('/api/lancamentos', methods=['GET'])
def obter_lancamentos():
    """Retorna todos os lançamentos"""
    lancamentos_list = Lancamento.query.all()
    return jsonify([l.to_dict() for l in lancamentos_list])

@app.route('/api/lancamentos', methods=['POST'])
def adicionar_lancamento():
    """Adiciona/Edita um lançamento"""
    data = request.json
    
    try:
        # Lógica de Edição
        if data.get('id'):
            lancamento = Lancamento.query.get(data['id'])
            if not lancamento:
                return jsonify({'erro': 'Lançamento não encontrado'}), 404
            
            # Atualiza campos
            for key, value in data.items():
                if hasattr(lancamento, key):
                    setattr(lancamento, key, value)
            
        # Lógica de Criação
        else:
            new_id = str(int(datetime.now().timestamp() * 1000))
            lancamento = Lancamento(
                id=new_id,
                colaboradorId=data['colaboradorId'],
                mes=data['mes'],
                ferias=data.get('ferias'),
                remuneracao=data.get('remuneracao'),
                bonificacao=data.get('bonificacao'),
                totalRecebido=data.get('totalRecebido'),
                adiantamentoEspecie=data.get('adiantamentoEspecie'),
                adiantamentoContab=data.get('adiantamentoContab'),
                horasExtras=data.get('horasExtras'),
                valeTransporte=data.get('valeTransporte'),
                emprestimo=data.get('emprestimo'),
                outros=data.get('outros'),
                liquidoTotal=data.get('liquidoTotal'),
                pagamentoContab=data.get('pagamentoContab'),
                pagamentoEspecie=data.get('pagamentoEspecie'),
                status=data.get('status', 'aberto')
            )
            db.session.add(lancamento)
            
        db.session.commit()
        return jsonify(lancamento.to_dict()), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"ERRO AO SALVAR LANÇAMENTO: {e}")
        return jsonify({'erro': 'Erro interno ao salvar lançamento'}), 500

@app.route('/api/lancamentos/<id>', methods=['DELETE'])
def excluir_lancamento(id):
    """Exclui um lançamento"""
    lancamento = Lancamento.query.get(id)
    if not lancamento:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
    
    try:
        db.session.delete(lancamento)
        db.session.commit()
        return jsonify({'mensagem': 'Lançamento excluído com sucesso'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'erro': 'Erro interno ao excluir lançamento'}), 500

@app.route('/api/lancamentos/<id>/finalizar', methods=['PUT'])
def finalizar_lancamento(id):
    """Finaliza um lançamento"""
    lancamento = Lancamento.query.get(id)
    if not lancamento:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
        
    lancamento.status = 'finalizado'
    db.session.commit()
    return jsonify({'mensagem': 'Lançamento finalizado'}), 200

@app.route('/api/lancamentos/<id>/reabrir', methods=['PUT'])
def reabrir_lancamento(id):
    """Reabre um lançamento"""
    lancamento = Lancamento.query.get(id)
    if not lancamento:
        return jsonify({'erro': 'Lançamento não encontrado'}), 404
        
    lancamento.status = 'aberto'
    db.session.commit()
    return jsonify({'mensagem': 'Lançamento reaberto'}), 200

# ==================== BACKUP (Mantido para compatibilidade) ====================

@app.route('/api/backup', methods=['GET'])
def fazer_backup():
    """Retorna todos os dados para backup (mantendo compatibilidade com o formato JSON)"""
    colaboradores_list = Colaborador.query.all()
    lancamentos_list = Lancamento.query.all()
    
    return jsonify({
        'colaboradores': [c.to_dict() for c in colaboradores_list],
        'lancamentos': [l.to_dict() for l in lancamentos_list]
    })

@app.route('/api/restaurar', methods=['POST'])
def restaurar_backup():
    """Restaura dados de um backup JSON. APENAS PARA TESTES."""
    data = request.json
    
    try:
        # Limpar tabelas existentes
        db.session.query(Lancamento).delete()
        db.session.query(Emprestimo).delete()
        db.session.query(Colaborador).delete()
        
        # Inserir novos dados
        for c_data in data.get('colaboradores', []):
            emprestimos_data = c_data.pop('emprestimos', [])
            
            # Cria colaborador
            colaborador = Colaborador(**{k: v for k, v in c_data.items() if k in Colaborador.__table__.columns})
            db.session.add(colaborador)
            db.session.flush() # Garante o ID do colaborador
            
            # Cria empréstimos
            for e_data in emprestimos_data:
                # O ID é copiado, mas garantimos o vínculo correto
                emprestimo = Emprestimo(colaborador_id=colaborador.id, **{k: v for k, v in e_data.items() if k in Emprestimo.__table__.columns})
                db.session.add(emprestimo)
                
        # Cria lançamentos
        for l_data in data.get('lancamentos', []):
            lancamento = Lancamento(**{k: v for k, v in l_data.items() if k in Lancamento.__table__.columns})
            db.session.add(lancamento)
            
        db.session.commit()
        return jsonify({'mensagem': 'Backup restaurado com sucesso'}), 200
    except Exception as e:
        db.session.rollback()
        print(f"ERRO NA RESTAURAÇÃO: {e}")
        return jsonify({'erro': 'Erro interno ao restaurar backup'}), 500

if __name__ == '__main__':
    # Criar pasta static se não existir (para o servidor de dev)
    if not os.path.exists('static'):
        os.makedirs('static')
    
    # Execução local
    app.run(debug=True, host='0.0.0.0', port=5000)