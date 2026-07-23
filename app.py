from flask import Flask, jsonify, request, render_template, redirect, url_for
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_login import (LoginManager, UserMixin, login_user, logout_user,
                         current_user)
import os
import json
import secrets
from datetime import datetime

# Carrega variáveis de um arquivo .env (útil para rodar localmente).
# Em produção (Railway) as variáveis vêm do próprio ambiente e isto é ignorado.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ==================== CONFIGURAÇÃO ====================

DB_FILE = 'dados.db'
basedir = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__,
            static_folder='static',
            template_folder='templates')
CORS(app)

# --- Segurança / Sessão ---
# Em produção, defina SECRET_KEY nas variáveis de ambiente do Railway.
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
)

# --- Banco de dados ---
# Em produção usa o PostgreSQL do Railway (variável DATABASE_URL).
# Localmente, cai automaticamente para um arquivo SQLite.
database_url = os.environ.get('DATABASE_URL')
if database_url:
    # Railway/Heroku às vezes fornecem o esquema legado "postgres://"
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, DB_FILE)

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- Autenticação (Flask-Login) ---
# Credenciais vêm das variáveis de ambiente. Troque a senha padrão em produção!
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

login_manager = LoginManager(app)
login_manager.login_view = 'login'


class Admin(UserMixin):
    """Usuário administrador único (credenciais no ambiente)."""
    id = 'admin'


@login_manager.user_loader
def load_user(user_id):
    return Admin() if user_id == 'admin' else None

# ==================== MODELOS (Estrutura do BD) ====================

class Colaborador(db.Model):
    # Tabela principal para dados do colaborador
    id = db.Column(db.String(50), primary_key=True)
    nome = db.Column(db.String(100), nullable=False)
    cpf = db.Column(db.String(14), unique=True, nullable=False)
    endereco = db.Column(db.String(255))
    funcao = db.Column(db.String(50))
    empresa = db.Column(db.String(50)) # 'Engenharia' ou 'Gerenciadora'
    contratacao = db.Column(db.String(50))
    admissao = db.Column(db.String(10)) # Data YYYY-MM-DD
    remuneracao = db.Column(db.Float)
    premio = db.Column(db.Float)
    valorDiaria = db.Column(db.Float) # usado quando contratacao = 'Diarista'
    total = db.Column(db.Float)
    # VARCHAR(10): "Sim"/"Não" cabem em 3, mas "Inativo" (seguroVida) tem 7 —
    # todos widened juntos para não deixar essa armadilha de novo.
    valeRefeicao = db.Column(db.String(10))
    valeTransporte = db.Column(db.String(10))
    seguroVida = db.Column(db.String(10))
    planoOdonto = db.Column(db.String(10))
    dependentes = db.Column(db.Integer)
    temAdiantamento = db.Column(db.String(10))
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
            "empresa": self.empresa,
            "contratacao": self.contratacao,
            "admissao": self.admissao,
            "remuneracao": self.remuneracao,
            "premio": self.premio,
            "valorDiaria": self.valorDiaria,
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
    diasTrabalhados = db.Column(db.Integer) # usado quando o colaborador é Diarista
    remuneracao = db.Column(db.Float)
    bonificacao = db.Column(db.Float)
    totalRecebido = db.Column(db.Float)
    adiantamentoEspecie = db.Column(db.Float)
    adiantamentoContab = db.Column(db.Float)
    horasExtras = db.Column(db.Float)
    assiduidade = db.Column(db.Float) # usado no cálculo do EVA (apenas CLT)
    cartaoAlimentacao = db.Column(db.Float) # registrado, mas não entra no EVA nem no líquido
    valeTransporte = db.Column(db.Float)
    emprestimo = db.Column(db.Float)
    outros = db.Column(db.Float)
    liquidoTotal = db.Column(db.Float)
    pagamentoContab = db.Column(db.Float)
    pagamentoEspecie = db.Column(db.Float)
    formaPagamento = db.Column(db.String(20)) # 'Depósito', 'Espécie' ou 'Depósito + Espécie'
    emprestimosPagos = db.Column(db.Text) # JSON: [{"id":..., "valor":...}] pagos no mês
    status = db.Column(db.String(20), default='aberto') # 'aberto' ou 'finalizado'

    def to_dict(self):
        """Converte objeto Lancamento para dicionário"""
        return {
            "id": self.id,
            "colaboradorId": self.colaboradorId,
            "mes": self.mes,
            "ferias": self.ferias,
            "diasTrabalhados": self.diasTrabalhados,
            "remuneracao": self.remuneracao,
            "bonificacao": self.bonificacao,
            "totalRecebido": self.totalRecebido,
            "adiantamentoEspecie": self.adiantamentoEspecie,
            "adiantamentoContab": self.adiantamentoContab,
            "horasExtras": self.horasExtras,
            "assiduidade": self.assiduidade,
            "cartaoAlimentacao": self.cartaoAlimentacao,
            "valeTransporte": self.valeTransporte,
            "emprestimo": self.emprestimo,
            "outros": self.outros,
            "liquidoTotal": self.liquidoTotal,
            "pagamentoContab": self.pagamentoContab,
            "pagamentoEspecie": self.pagamentoEspecie,
            "formaPagamento": self.formaPagamento,
            "emprestimosPagos": json.loads(self.emprestimosPagos) if self.emprestimosPagos else [],
            "status": self.status
        }

# ==================== FUNÇÃO DE SETUP DO BD ====================

# Cria as tabelas se elas não existirem no arquivo SQLite
with app.app_context():
    db.create_all()

    # Migração leve: adiciona colunas novas a tabelas já existentes (SQLite não faz isso
    # automaticamente pelo create_all). Mantém os dados atuais intactos.
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)

    colunas_lancamento = {col['name'] for col in inspector.get_columns('lancamento')}
    if 'formaPagamento' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "formaPagamento" VARCHAR(20)'))
    if 'diasTrabalhados' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "diasTrabalhados" INTEGER'))
    if 'emprestimosPagos' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "emprestimosPagos" TEXT'))
    if 'assiduidade' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN assiduidade FLOAT'))
    if 'cartaoAlimentacao' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "cartaoAlimentacao" FLOAT'))

    colunas_colaborador = {col['name'] for col in inspector.get_columns('colaborador')}
    if 'empresa' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN empresa VARCHAR(50)'))
    if 'valorDiaria' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN "valorDiaria" FLOAT'))

    # Corrige colunas antigas criadas pequenas demais (ex.: seguroVida guardava
    # "Ativo"/"Inativo" em VARCHAR(3)). SQLite não enforce isso e não suporta
    # ALTER COLUMN TYPE, então essa correção só roda no PostgreSQL.
    if db.engine.dialect.name == 'postgresql':
        colunas_para_alargar = ['valeRefeicao', 'valeTransporte', 'seguroVida',
                                 'planoOdonto', 'temAdiantamento']
        for coluna in colunas_para_alargar:
            db.session.execute(text(
                f'ALTER TABLE colaborador ALTER COLUMN "{coluna}" TYPE VARCHAR(10)'
            ))

    db.session.commit()

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

# ==================== AUTENTICAÇÃO ====================

@app.before_request
def exigir_login():
    """Exige login para tudo, exceto a tela de login e os arquivos estáticos."""
    if request.endpoint in ('login', 'static'):
        return
    if not current_user.is_authenticated:
        if request.path.startswith('/api/'):
            return jsonify({'erro': 'Não autenticado'}), 401
        return redirect(url_for('login', next=request.path))


def _url_interna_segura(destino):
    """Evita open redirect: só aceita caminhos internos (iniciados por '/')."""
    if destino and destino.startswith('/') and not destino.startswith('//'):
        return destino
    return None


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')
        if (secrets.compare_digest(username, ADMIN_USERNAME) and
                secrets.compare_digest(password, ADMIN_PASSWORD)):
            login_user(Admin(), remember=True)
            destino = _url_interna_segura(request.args.get('next')) or url_for('index')
            return redirect(destino)
        return render_template('login.html', erro='Usuário ou senha inválidos.'), 401

    return render_template('login.html')


@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))


# ==================== ROTAS DE PÁGINAS (URLs limpas) ====================
# Arquivos estáticos (CSS/JS) são servidos automaticamente pelo Flask em /static/.

@app.route('/')
def index():
    """Dashboard (página inicial)."""
    return render_template('index.html')

@app.route('/colaboradores')
def pagina_colaboradores():
    """Página de gestão de colaboradores."""
    return render_template('colaboradores.html')

@app.route('/lancamentos')
def pagina_lancamentos():
    """Página de lançamentos mensais."""
    return render_template('lancamentos.html')

# Compatibilidade: redireciona as URLs antigas com .html para as URLs limpas.
@app.route('/index.html')
def redir_index():
    return redirect(url_for('index'), code=301)

@app.route('/colaboradores.html')
def redir_colaboradores():
    return redirect(url_for('pagina_colaboradores'), code=301)

@app.route('/lancamentos.html')
def redir_lancamentos():
    return redirect(url_for('pagina_lancamentos'), code=301)

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
                empresa=data.get('empresa'),
                contratacao=data.get('contratacao'),
                admissao=data.get('admissao'),
                remuneracao=data.get('remuneracao', 0),
                premio=data.get('premio', 0),
                valorDiaria=data.get('valorDiaria', 0),
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
            
            # Atualiza campos (emprestimosPagos é tratado à parte, pois é JSON)
            for key, value in data.items():
                if key == 'emprestimosPagos':
                    lancamento.emprestimosPagos = json.dumps(value or [])
                elif hasattr(lancamento, key):
                    setattr(lancamento, key, value)
            
        # Lógica de Criação
        else:
            new_id = str(int(datetime.now().timestamp() * 1000))
            lancamento = Lancamento(
                id=new_id,
                colaboradorId=data['colaboradorId'],
                mes=data['mes'],
                ferias=data.get('ferias'),
                diasTrabalhados=data.get('diasTrabalhados', 0),
                remuneracao=data.get('remuneracao'),
                bonificacao=data.get('bonificacao'),
                totalRecebido=data.get('totalRecebido'),
                adiantamentoEspecie=data.get('adiantamentoEspecie'),
                adiantamentoContab=data.get('adiantamentoContab'),
                horasExtras=data.get('horasExtras'),
                assiduidade=data.get('assiduidade', 0),
                cartaoAlimentacao=data.get('cartaoAlimentacao', 0),
                valeTransporte=data.get('valeTransporte'),
                emprestimo=data.get('emprestimo'),
                outros=data.get('outros'),
                liquidoTotal=data.get('liquidoTotal'),
                pagamentoContab=data.get('pagamentoContab'),
                pagamentoEspecie=data.get('pagamentoEspecie'),
                formaPagamento=data.get('formaPagamento', 'Depósito'),
                emprestimosPagos=json.dumps(data.get('emprestimosPagos', [])),
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

# ==================== BACKUP (somente leitura) ====================

@app.route('/api/backup', methods=['GET'])
def fazer_backup():
    """Retorna todos os dados em JSON para fins de backup."""
    colaboradores_list = Colaborador.query.all()
    lancamentos_list = Lancamento.query.all()
    
    return jsonify({
        'colaboradores': [c.to_dict() for c in colaboradores_list],
        'lancamentos': [l.to_dict() for l in lancamentos_list]
    })

if __name__ == '__main__':
    # Criar pasta static se não existir (para o servidor de dev)
    if not os.path.exists('static'):
        os.makedirs('static')
    
    # Execução local (porta configurável via variável PORT)
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=True, host='0.0.0.0', port=port)