from flask import Flask, jsonify, request, render_template, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import (LoginManager, UserMixin, login_user, logout_user,
                         current_user)
import os
import sys
import json
import secrets
import hashlib
import smtplib
import threading
import time
from email.message import EmailMessage
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

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
# Sem CORS: o front-end é servido pelo próprio app (mesma origem), então nenhuma
# origem externa precisa chamar a API.

# --- Segurança / Sessão ---
# Em produção, defina SECRET_KEY nas variáveis de ambiente do Railway.
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
# Em produção (Railway, com DATABASE_URL) os cookies só trafegam por HTTPS.
EM_PRODUCAO = bool(os.environ.get('DATABASE_URL'))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=EM_PRODUCAO,
    # "Lembrar de mim": 7 dias (o padrão do Flask-Login é 365).
    REMEMBER_COOKIE_DURATION=timedelta(days=7),
    REMEMBER_COOKIE_HTTPONLY=True,
    REMEMBER_COOKIE_SAMESITE='Lax',
    REMEMBER_COOKIE_SECURE=EM_PRODUCAO,
)

# --- Banco de dados ---
# Em produção usa o PostgreSQL do Railway (variável DATABASE_URL).
# Localmente, cai automaticamente para um arquivo SQLite.
database_url = os.environ.get('DATABASE_URL')
if database_url:
    # Railway/Heroku às vezes fornecem o esquema legado "postgres://"
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    # Força o driver instalado (psycopg2-binary), mesmo que a URL venha com outro
    # driver explícito (ex.: "postgresql+psycopg://"), que não está no requirements.
    if database_url.startswith(('postgresql://', 'postgresql+psycopg://')):
        database_url = database_url.replace('postgresql+psycopg://', 'postgresql://', 1)
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg2://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, DB_FILE)

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# Evita erros de conexão "SSL SYSCALL error: EOF detected" quando o Postgres
# do Railway derruba conexões ociosas do pool: pool_pre_ping testa a conexão
# antes de usá-la (reconecta se estiver morta) e pool_recycle a recicla
# periodicamente antes que o servidor a feche por timeout.
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_pre_ping': True,
    'pool_recycle': 280,
}
db = SQLAlchemy(app)

# --- Autenticação (Flask-Login) ---
# Credenciais vêm das variáveis de ambiente. Troque a senha padrão em produção!
# Os usuários ficam na tabela "usuario" (senha com hash). Não há usuário padrão:
# crie-os com `python criar_usuario.py <usuario> <email> <senha>`.

login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Atrás do proxy do Railway: respeita X-Forwarded-Proto/Host (links https corretos).
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


class Usuario(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), nullable=True)
    senha_hash = db.Column(db.String(255), nullable=False)
    # Redefinição de senha: guardamos só o hash do token e a validade.
    reset_token_hash = db.Column(db.String(64), nullable=True)
    reset_expira = db.Column(db.DateTime, nullable=True)

    def definir_senha(self, senha):
        self.senha_hash = generate_password_hash(senha)

    def confere_senha(self, senha):
        return check_password_hash(self.senha_hash, senha)


@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(Usuario, int(user_id))
    except (TypeError, ValueError):
        return None

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
    fimContrato = db.Column(db.String(10)) # LEGADO: substituído por contratosJson (só usado na migração)
    desligado = db.Column(db.String(10)) # LEGADO: substituído por contratosJson (só usado na migração)
    # Períodos de contrato (Mensalista/Diarista): JSON [{"inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD"|""}].
    # Lista vazia = sem controle de vigência (sempre disponível para lançamentos).
    contratosJson = db.Column(db.Text)
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
            "contratos": json.loads(self.contratosJson) if self.contratosJson else [],
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
    diasFerias = db.Column(db.Integer) # quantidade de dias de férias no mês (usado quando ferias = 'Férias')
    diasTrabalhados = db.Column(db.Integer) # usado quando o colaborador é Diarista
    remuneracao = db.Column(db.Float)
    bonificacao = db.Column(db.Float)
    totalRecebido = db.Column(db.Float)
    adiantamentoEspecie = db.Column(db.Float)
    adiantamentoContab = db.Column(db.Float)
    horasExtras = db.Column(db.Float)
    assiduidade = db.Column(db.Float) # usado no cálculo do EVA (apenas CLT)
    combustivel = db.Column(db.Float) # usado no cálculo do EVA (apenas CLT)
    cartaoAlimentacao = db.Column(db.Float) # registrado, mas não entra no EVA nem no líquido
    valeTransporte = db.Column(db.Float)
    emprestimo = db.Column(db.Float)
    outros = db.Column(db.Float)
    liquidoTotal = db.Column(db.Float)
    pagamentoContab = db.Column(db.Float)
    pagamentoEspecie = db.Column(db.Float)
    formaPagamento = db.Column(db.String(20)) # 'Depósito', 'Espécie' ou 'Depósito + Espécie'
    emprestimosPagos = db.Column(db.Text) # JSON: [{"id":..., "valor":...}] pagos no mês
    faltas = db.Column(db.Text) # JSON: [{"data":"YYYY-MM-DD", "obs":...}]
    atestados = db.Column(db.Text) # JSON: [{"data":"YYYY-MM-DD", "dias":N, "obs":...}]
    status = db.Column(db.String(20), default='aberto') # 'aberto' ou 'finalizado'

    def to_dict(self):
        """Converte objeto Lancamento para dicionário"""
        return {
            "id": self.id,
            "colaboradorId": self.colaboradorId,
            "mes": self.mes,
            "ferias": self.ferias,
            "diasFerias": self.diasFerias,
            "diasTrabalhados": self.diasTrabalhados,
            "remuneracao": self.remuneracao,
            "bonificacao": self.bonificacao,
            "totalRecebido": self.totalRecebido,
            "adiantamentoEspecie": self.adiantamentoEspecie,
            "adiantamentoContab": self.adiantamentoContab,
            "horasExtras": self.horasExtras,
            "assiduidade": self.assiduidade,
            "combustivel": self.combustivel,
            "cartaoAlimentacao": self.cartaoAlimentacao,
            "valeTransporte": self.valeTransporte,
            "emprestimo": self.emprestimo,
            "outros": self.outros,
            "liquidoTotal": self.liquidoTotal,
            "pagamentoContab": self.pagamentoContab,
            "pagamentoEspecie": self.pagamentoEspecie,
            "formaPagamento": self.formaPagamento,
            "emprestimosPagos": json.loads(self.emprestimosPagos) if self.emprestimosPagos else [],
            "faltas": json.loads(self.faltas) if self.faltas else [],
            "atestados": json.loads(self.atestados) if self.atestados else [],
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
    if 'diasFerias' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "diasFerias" INTEGER'))
    if 'emprestimosPagos' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "emprestimosPagos" TEXT'))
    if 'assiduidade' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN assiduidade FLOAT'))
    if 'combustivel' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN combustivel FLOAT'))
    if 'cartaoAlimentacao' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN "cartaoAlimentacao" FLOAT'))
    if 'faltas' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN faltas TEXT'))
    if 'atestados' not in colunas_lancamento:
        db.session.execute(text('ALTER TABLE lancamento ADD COLUMN atestados TEXT'))

    colunas_colaborador = {col['name'] for col in inspector.get_columns('colaborador')}
    if 'empresa' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN empresa VARCHAR(50)'))
    if 'valorDiaria' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN "valorDiaria" FLOAT'))
    if 'fimContrato' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN "fimContrato" VARCHAR(10)'))
    if 'desligado' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN "desligado" VARCHAR(10)'))
    if 'contratosJson' not in colunas_colaborador:
        db.session.execute(text('ALTER TABLE colaborador ADD COLUMN "contratosJson" TEXT'))
        db.session.commit()
        # Converte o antigo "Fim do Contrato" em um período (admissão -> fim).
        for c in Colaborador.query.filter(Colaborador.fimContrato.isnot(None),
                                          Colaborador.fimContrato != '').all():
            c.contratosJson = json.dumps([{'inicio': c.admissao or '', 'fim': c.fimContrato}])

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

# ==================== CABEÇALHOS DE SEGURANÇA ====================

CSP = ("default-src 'self'; "
       # O front-end usa <script> e handlers inline, por isso 'unsafe-inline' em scripts.
       "script-src 'self' 'unsafe-inline'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com "
       "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; "
       "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com "
       "https://cdn.jsdelivr.net; "
       "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


@app.after_request
def cabecalhos_seguranca(resp):
    resp.headers['Content-Security-Policy'] = CSP
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['Referrer-Policy'] = 'same-origin'
    resp.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    if request.is_secure:
        resp.headers['Strict-Transport-Security'] = 'max-age=31536000'
    # Dados de folha/CPF: nada de cache de páginas e da API (arquivos estáticos podem).
    if request.endpoint != 'static':
        resp.headers['Cache-Control'] = 'no-store'
    return resp


# ==================== LIMITE DE TENTATIVAS ====================
# Em memória (por processo): suficiente para o app rodando com um worker. Protege
# contra tentativa de senha em massa e contra uso do "esqueci a senha" para spam.

_tentativas = {}
_tentativas_lock = threading.Lock()


def _recentes(chave, janela_s):
    agora = time.time()
    lista = [t for t in _tentativas.get(chave, []) if agora - t < janela_s]
    if lista:
        _tentativas[chave] = lista
    else:
        _tentativas.pop(chave, None)
    return lista


def limite_excedido(chave, maximo, janela_s):
    with _tentativas_lock:
        return len(_recentes(chave, janela_s)) >= maximo


def registrar_tentativa(chave, janela_s):
    with _tentativas_lock:
        _recentes(chave, janela_s)
        _tentativas.setdefault(chave, []).append(time.time())
        if len(_tentativas) > 5000:  # evita crescer sem limite
            for k in list(_tentativas):
                _recentes(k, janela_s)


def limpar_tentativas(chave):
    with _tentativas_lock:
        _tentativas.pop(chave, None)


JANELA_LOGIN = 15 * 60          # 15 min
MAX_LOGIN_EMAIL = 5             # falhas por e-mail
MAX_LOGIN_IP = 20               # falhas por IP
JANELA_RESET = 60 * 60          # 1 h
MAX_RESET_EMAIL = 3             # pedidos por e-mail
MAX_RESET_IP = 10               # pedidos por IP


# ==================== AUTENTICAÇÃO ====================

@app.before_request
def exigir_login():
    """Exige login para tudo, exceto a tela de login e os arquivos estáticos."""
    if request.endpoint in ('login', 'static', 'esqueci_senha', 'redefinir_senha'):
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
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        ip = request.remote_addr or '?'
        chave_ip, chave_email = f'login-ip:{ip}', f'login-email:{email}'
        if (limite_excedido(chave_ip, MAX_LOGIN_IP, JANELA_LOGIN)
                or limite_excedido(chave_email, MAX_LOGIN_EMAIL, JANELA_LOGIN)):
            return render_template('login.html',
                                   erro='Muitas tentativas. Aguarde alguns minutos e tente novamente.'), 429
        usuario = (Usuario.query.filter(db.func.lower(Usuario.email) == email).first()
                   if email else None)
        if usuario and usuario.confere_senha(password):
            limpar_tentativas(chave_email)
            login_user(usuario, remember=True)
            destino = _url_interna_segura(request.args.get('next')) or url_for('index')
            return redirect(destino)
        registrar_tentativa(chave_ip, JANELA_LOGIN)
        registrar_tentativa(chave_email, JANELA_LOGIN)
        return render_template('login.html', erro='E-mail ou senha inválidos.'), 401

    return render_template('login.html', sucesso=request.args.get('ok'))


# ---------- Redefinição de senha por e-mail ----------

RESET_VALIDADE_MIN = 30


def _enviar_email(destino, assunto, corpo):
    """Envia via SMTP (variáveis SMTP_*). Sem SMTP configurado, só registra no log."""
    host = os.environ.get('SMTP_HOST')
    if not host:
        print(f'[email não configurado] Para: {destino} | {assunto}\n{corpo}', file=sys.stderr, flush=True)
        return
    msg = EmailMessage()
    msg['Subject'] = assunto
    msg['From'] = os.environ.get('SMTP_FROM') or os.environ.get('SMTP_USER', '')
    msg['To'] = destino
    msg.set_content(corpo)
    porta = int(os.environ.get('SMTP_PORT', '587'))
    try:
        if porta == 465:
            servidor = smtplib.SMTP_SSL(host, porta, timeout=15)
        else:
            servidor = smtplib.SMTP(host, porta, timeout=15)
            servidor.starttls()
        with servidor:
            if os.environ.get('SMTP_USER'):
                servidor.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD', ''))
            servidor.send_message(msg)
        print(f'[email enviado] Para: {destino}', file=sys.stderr, flush=True)
    except Exception as e:
        print(f'[erro ao enviar e-mail] {e}', file=sys.stderr, flush=True)


def _hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


@app.route('/esqueci-senha', methods=['GET', 'POST'])
def esqueci_senha():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        ip = request.remote_addr or '?'
        chave_ip, chave_email = f'reset-ip:{ip}', f'reset-email:{email}'
        bloqueado = (limite_excedido(chave_ip, MAX_RESET_IP, JANELA_RESET)
                     or limite_excedido(chave_email, MAX_RESET_EMAIL, JANELA_RESET))
        registrar_tentativa(chave_ip, JANELA_RESET)
        registrar_tentativa(chave_email, JANELA_RESET)
        # Acima do limite: mesma resposta da tela, mas sem enviar nada (não revela o bloqueio).
        usuario = (Usuario.query.filter(db.func.lower(Usuario.email) == email).first()
                   if email and not bloqueado else None)
        print(f'[reset senha] pedido para "{email}"{" (limite excedido)" if bloqueado else ""}: '
              f'{"usuario encontrado" if usuario else "NENHUM usuario com esse e-mail"}', file=sys.stderr, flush=True)
        if usuario:
            token = secrets.token_urlsafe(32)
            usuario.reset_token_hash = _hash_token(token)
            usuario.reset_expira = datetime.utcnow() + timedelta(minutes=RESET_VALIDADE_MIN)
            db.session.commit()
            base = os.environ.get('APP_URL', '').rstrip('/') or request.url_root.rstrip('/')
            link = f'{base}/redefinir-senha/{token}'
            corpo = (f'Olá, {usuario.username}.\n\n'
                     f'Recebemos um pedido para redefinir sua senha no Sistema DP.\n'
                     f'Acesse o link abaixo (válido por {RESET_VALIDADE_MIN} minutos):\n\n{link}\n\n'
                     f'Se você não fez esse pedido, ignore este e-mail.')
            # Envia em segundo plano para não atrasar (nem revelar pelo tempo) a resposta.
            threading.Thread(target=_enviar_email,
                             args=(usuario.email, 'Redefinição de senha · Sistema DP', corpo),
                             daemon=True).start()
        # Mesma resposta exista o e-mail ou não (não revela quais e-mails estão cadastrados).
        return render_template('esqueci_senha.html', enviado=True)
    return render_template('esqueci_senha.html')


@app.route('/redefinir-senha/<token>', methods=['GET', 'POST'])
def redefinir_senha(token):
    usuario = Usuario.query.filter_by(reset_token_hash=_hash_token(token)).first()
    valido = bool(usuario and usuario.reset_expira and usuario.reset_expira > datetime.utcnow())
    if not valido:
        return render_template('redefinir_senha.html', invalido=True), 400

    if request.method == 'POST':
        senha = request.form.get('password', '')
        confirmacao = request.form.get('confirm', '')
        if len(senha) < 6:
            return render_template('redefinir_senha.html', erro='A senha deve ter pelo menos 6 caracteres.'), 400
        if senha != confirmacao:
            return render_template('redefinir_senha.html', erro='As senhas não coincidem.'), 400
        usuario.definir_senha(senha)
        usuario.reset_token_hash = None
        usuario.reset_expira = None
        db.session.commit()
        return redirect(url_for('login', ok='Senha redefinida. Faça login com a nova senha.'))
    return render_template('redefinir_senha.html')


@app.route('/conta', methods=['GET', 'POST'])
def conta():
    """Cada usuário cadastra o próprio e-mail (usado na recuperação) e troca a senha."""
    msg = erro = None
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        atual = request.form.get('senha_atual', '')
        nova = request.form.get('nova_senha', '')
        confirma = request.form.get('confirma', '')
        if not current_user.confere_senha(atual):
            erro = 'Senha atual incorreta.'
        elif not email or '@' not in email:
            erro = 'E-mail inválido.'
        elif nova and len(nova) < 6:
            erro = 'A nova senha deve ter pelo menos 6 caracteres.'
        elif nova and nova != confirma:
            erro = 'As senhas não coincidem.'
        elif email and Usuario.query.filter(db.func.lower(Usuario.email) == email,
                                            Usuario.id != current_user.id).first():
            erro = 'Este e-mail já está em uso por outro usuário.'
        else:
            current_user.email = email or None
            if nova:
                current_user.definir_senha(nova)
            db.session.commit()
            msg = 'Dados atualizados.'
    return render_template('conta.html', msg=msg, erro=erro), (400 if erro else 200)


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
        
        contratos_json, erro_contratos = _normalizar_contratos(data.get('contratos'))
        if erro_contratos:
            return jsonify({'erro': erro_contratos}), 400

        # 2. Lógica de Edição
        if data.get('id'):
            colaborador = Colaborador.query.get(data['id'])
            if not colaborador:
                return jsonify({'erro': 'Colaborador não encontrado'}), 404
            
            # Atualiza campos do colaborador
            for key, value in data.items():
                if (hasattr(colaborador, key)
                        and key not in ('emprestimos', 'contratos', 'contratosJson',
                                        'fimContrato', 'desligado')):
                    setattr(colaborador, key, value)
            if 'contratos' in data:
                colaborador.contratosJson = contratos_json
            
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
                contratosJson=contratos_json,
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

def _normalizar_contratos(lista):
    """Valida os períodos de contrato. Retorna (json_str, erro). Cada período precisa de
    início; fim vazio = em aberto. Períodos não podem se sobrepor."""
    periodos = []
    for p in (lista or []):
        inicio = (p.get('inicio') or '').strip()
        fim = (p.get('fim') or '').strip()
        if not inicio and not fim:
            continue
        if not _data_iso(inicio):
            return None, 'Informe a data de início de cada período de contrato.'
        if fim and not _data_iso(fim):
            return None, 'Data de fim de contrato inválida.'
        if fim and fim < inicio:
            return None, 'O fim do contrato não pode ser anterior ao início.'
        periodos.append({'inicio': inicio, 'fim': fim})
    periodos.sort(key=lambda p: p['inicio'])
    for anterior, atual in zip(periodos, periodos[1:]):
        if not anterior['fim'] or atual['inicio'] <= anterior['fim']:
            return None, 'Os períodos de contrato não podem se sobrepor.'
    return (json.dumps(periodos) if periodos else None), None


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

# ==================== EXPORTAÇÃO DE PLANILHA (XLSX) ====================

def _data_iso(valor):
    """'YYYY-MM-DD' -> datetime (ou None se vazio/inválido)."""
    try:
        return datetime.strptime(valor, '%Y-%m-%d') if valor else None
    except (TypeError, ValueError):
        return None


def _novo_workbook():
    """Workbook vazio + estilos usados nas planilhas (cabeçalho dourado SEPRES)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    wb.remove(wb.active)
    estilo = {'fonte': Font(bold=True, color='FFFFFF'),
              'fundo': PatternFill('solid', fgColor='A89826'),
              'alinhamento': Alignment(vertical='center')}
    return wb, estilo


def _preencher_aba(wb, estilo, nome_aba, colunas, registros):
    """colunas: lista de (título, chave, é moeda, é data, largura)."""
    from openpyxl.utils import get_column_letter
    ws = wb.create_sheet(nome_aba)
    for i, (titulo, chave, moeda, data, largura) in enumerate(colunas, start=1):
        c = ws.cell(row=1, column=i, value=titulo or None)
        c.font, c.fill, c.alignment = estilo['fonte'], estilo['fundo'], estilo['alinhamento']
        ws.column_dimensions[get_column_letter(i)].width = largura
    for r, reg in enumerate(registros, start=2):
        for i, (_, chave, moeda, data, _) in enumerate(colunas, start=1):
            c = ws.cell(row=r, column=i, value=reg[chave])
            if moeda:
                c.number_format = '"R$" #,##0.00'
            elif data:
                c.number_format = 'dd/mm/yyyy'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(colunas))}{max(1, len(registros) + 1)}'


def _enviar_xlsx(wb, nome_arquivo):
    from io import BytesIO
    from flask import send_file
    saida = BytesIO()
    wb.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name=nome_arquivo,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def _contrato_encerrado(colab):
    """Mensalista/Diarista cujos períodos de contrato já terminaram todos (sem período
    vigente nem futuro). CLT e quem não tem períodos cadastrados nunca está encerrado."""
    if colab.contratacao == 'CLT' or not colab.contratosJson:
        return False
    periodos = json.loads(colab.contratosJson)
    if not periodos:
        return False
    hoje = datetime.now().strftime('%Y-%m-%d')
    for p in periodos:
        inicio, fim = p.get('inicio') or '', p.get('fim') or ''
        if (not inicio or inicio <= hoje) and (not fim or hoje <= fim):
            return False  # vigente
        if inicio and inicio > hoje:
            return False  # período futuro
    return True


@app.route('/api/exportar-colaboradores', methods=['GET'])
def exportar_colaboradores():
    """Planilha de COLABORADORES no padrão da contabilidade: uma aba por empresa, com as
    colunas na ordem do modelo. Usa os dados do cadastro; contratos encerrados ficam de fora."""
    colaboradores_list = [c for c in Colaborador.query.all() if not _contrato_encerrado(c)]
    if not colaboradores_list:
        return jsonify({'erro': 'Não há colaboradores para exportar.'}), 404

    def dados(c):
        periodos = sorted(json.loads(c.contratosJson), key=lambda p: p.get('inicio') or '') \
            if c.contratosJson else []
        inicio_contrato = None
        if c.contratacao != 'CLT':
            # Início do contrato: começo do primeiro período; sem períodos, a admissão.
            inicio_contrato = _data_iso(periodos[0].get('inicio')) if periodos and periodos[0].get('inicio') \
                else _data_iso(c.admissao)
        return {
            'tipo': 'CLT' if c.contratacao == 'CLT' else 'CONTRATO',
            'cpf': c.cpf, 'nome': (c.nome or '').strip(),
            # No Diarista o "salário" da planilha é o valor da diária.
            'salario': (c.valorDiaria if c.contratacao == 'Diarista' else c.remuneracao) or 0,
            'bonificacao': c.premio or 0,
            'bonus_dinheiro': None,  # não existe no cadastro: preencher à mão se necessário
            'cargo': (c.funcao or '').strip(),
            'admissao': _data_iso(c.admissao),
            'inicio_contrato': inicio_contrato,
        }

    layouts = {
        'Gerenciadora': [
            ('', 'tipo', 0, 0, 12), ('CPF', 'cpf', 0, 0, 16), ('Nome completo', 'nome', 0, 0, 38),
            ('Salário', 'salario', 1, 0, 14), ('Bonificação', 'bonificacao', 1, 0, 14),
            ('Bonus em Dinheiro', 'bonus_dinheiro', 1, 0, 18), ('Cargo', 'cargo', 0, 0, 36),
            ('Admissão', 'admissao', 0, 1, 14)],
        'Engenharia': [
            ('Nome', 'nome', 0, 0, 38), ('Salário', 'salario', 1, 0, 14),
            ('Bonus', 'bonificacao', 1, 0, 14), ('Bonus em Dinheiro', 'bonus_dinheiro', 1, 0, 18),
            ('', 'tipo', 0, 0, 12), ('ADMISSÃO', 'admissao', 0, 1, 14),
            ('Inicio de contrato', 'inicio_contrato', 0, 1, 18), ('CPF', 'cpf', 0, 0, 16)],
    }
    por_empresa = {}
    for c in colaboradores_list:
        aba = c.empresa if c.empresa in layouts else 'Gerenciadora'
        por_empresa.setdefault(aba, []).append(dados(c))

    wb, estilo = _novo_workbook()
    for aba in ('Gerenciadora', 'Engenharia'):
        registros = sorted(por_empresa.get(aba, []), key=lambda r: r['nome'].lower())
        _preencher_aba(wb, estilo, aba, layouts[aba], registros)
    return _enviar_xlsx(wb, f'colaboradores_{datetime.now().strftime("%d-%m-%Y")}.xlsx')


@app.route('/api/exportar-eva', methods=['GET'])
def exportar_eva():
    """Planilha do EVA do mês (somente CLT): Prêmio + Assiduidade + Horas Extras + Combustível.
    Entram todos os CLT com lançamento no mês, inclusive os zerados."""
    mes = request.args.get('mes', '')
    if len(mes) != 7:
        return jsonify({'erro': 'Informe o mês (YYYY-MM).'}), 400
    empresa = request.args.get('empresa', 'todas')  # todas | Engenharia | Gerenciadora
    if empresa not in ('todas', 'Engenharia', 'Gerenciadora'):
        return jsonify({'erro': 'Empresa inválida.'}), 400
    consulta = (db.session.query(Lancamento, Colaborador)
                .join(Colaborador, Lancamento.colaboradorId == Colaborador.id)
                .filter(Lancamento.mes == mes, Colaborador.contratacao == 'CLT'))
    if empresa != 'todas':
        consulta = consulta.filter(Colaborador.empresa == empresa)
    linhas = consulta.all()
    registros = []
    for l, c in linhas:
        premio, assiduidade, extras = l.bonificacao or 0, l.assiduidade or 0, l.horasExtras or 0
        combustivel = l.combustivel or 0
        total = premio + assiduidade + extras + combustivel  # o cartão alimentação não soma no EVA
        registros.append({'nome': (c.nome or '').strip(), 'empresa': c.empresa or '',
                          'premio': premio, 'assiduidade': assiduidade, 'extras': extras,
                          'combustivel': combustivel, 'alimentacao': l.cartaoAlimentacao or 0,
                          'eva': total})
    if not registros:
        return jsonify({'erro': 'Não há lançamentos de CLT no mês selecionado.'}), 404
    registros.sort(key=lambda r: r['nome'].lower())
    colunas = [('Nome', 'nome', 0, 0, 38), ('Empresa', 'empresa', 0, 0, 16),
               ('Prêmio', 'premio', 1, 0, 16), ('Assiduidade', 'assiduidade', 1, 0, 16),
               ('Horas Extras', 'extras', 1, 0, 16), ('Combustível', 'combustivel', 1, 0, 16),
               ('EVA (total)', 'eva', 1, 0, 16), ('Cartão Alimentação', 'alimentacao', 1, 0, 20)]
    wb, estilo = _novo_workbook()
    _preencher_aba(wb, estilo, 'EVA', colunas, registros)
    return _enviar_xlsx(wb, f'eva_{mes[5:]}-{mes[:4]}{"" if empresa == "todas" else "_" + empresa.lower()}.xlsx')


@app.route('/api/exportar-planilha', methods=['GET'])
def exportar_planilha():
    """Planilha de PAGAMENTOS do mês: Nome, Empresa, Pagamento em Espécie e Pagamento em
    Conta. Só entra quem tem valor em pelo menos um dos dois pagamentos. No CLT, o Vale
    Transporte é somado ao Pagamento em Espécie (dinheiro)."""
    from sqlalchemy import or_, and_
    mes = request.args.get('mes', '')
    if len(mes) != 7:
        return jsonify({'erro': 'Informe o mês (YYYY-MM).'}), 400
    # Categoria: todos | clt | contrato (Mensalista + Diarista)
    tipo = request.args.get('tipo', 'todos')
    if tipo not in ('todos', 'clt', 'contrato'):
        return jsonify({'erro': 'Tipo inválido.'}), 400
    empresa = request.args.get('empresa', 'todas')  # todas | Engenharia | Gerenciadora
    if empresa not in ('todas', 'Engenharia', 'Gerenciadora'):
        return jsonify({'erro': 'Empresa inválida.'}), 400

    consulta = (db.session.query(Lancamento, Colaborador)
                .join(Colaborador, Lancamento.colaboradorId == Colaborador.id)
                .filter(Lancamento.mes == mes)
                .filter(or_(Lancamento.pagamentoEspecie > 0, Lancamento.pagamentoContab > 0,
                            # Vale Transporte do CLT sai como pagamento em dinheiro
                            and_(Colaborador.contratacao == 'CLT', Lancamento.valeTransporte > 0))))
    if tipo == 'clt':
        consulta = consulta.filter(Colaborador.contratacao == 'CLT')
    elif tipo == 'contrato':
        consulta = consulta.filter(Colaborador.contratacao != 'CLT')
    if empresa != 'todas':
        consulta = consulta.filter(Colaborador.empresa == empresa)
    linhas = consulta.all()
    if not linhas:
        return jsonify({'erro': 'Não há pagamentos lançados para o mês, a categoria e a empresa selecionados.'}), 404

    registros = sorted(
        ({'nome': (c.nome or '').strip(), 'empresa': c.empresa or '',
          # CLT: o Vale Transporte entra junto do Pagamento em Espécie (dinheiro)
          'especie': (l.pagamentoEspecie or 0) + ((l.valeTransporte or 0) if c.contratacao == 'CLT' else 0),
          'conta': l.pagamentoContab or 0,
          'liquido': l.liquidoTotal or 0}
         for l, c in linhas),
        key=lambda r: r['nome'].lower())
    colunas = [('Nome', 'nome', 0, 0, 38), ('Empresa', 'empresa', 0, 0, 16),
               ('Pagamento em Espécie', 'especie', 1, 0, 22),
               ('Pagamento em Conta', 'conta', 1, 0, 22)]
    # Nas planilhas por empresa (Construtora/Gerenciadora) entra também o Líquido Total salvo
    # no lançamento (pode ser negativo enquanto só o adiantamento foi lançado).
    if empresa != 'todas':
        colunas.append(('Líquido Total', 'liquido', 1, 0, 18))
    wb, estilo = _novo_workbook()
    _preencher_aba(wb, estilo, 'Pagamentos', colunas, registros)
    return _enviar_xlsx(
        wb, f'pagamentos_{mes[5:]}-{mes[:4]}{"" if tipo == "todos" else "_" + tipo}'
            f'{"" if empresa == "todas" else "_" + empresa.lower()}.xlsx')


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
            
            # Atualiza campos (emprestimosPagos/faltas/atestados são tratados à parte, pois são JSON)
            campos_json = {'emprestimosPagos', 'faltas', 'atestados'}
            for key, value in data.items():
                if key in campos_json:
                    setattr(lancamento, key, json.dumps(value or []))
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
                diasFerias=data.get('diasFerias', 0),
                diasTrabalhados=data.get('diasTrabalhados', 0),
                remuneracao=data.get('remuneracao'),
                bonificacao=data.get('bonificacao'),
                totalRecebido=data.get('totalRecebido'),
                adiantamentoEspecie=data.get('adiantamentoEspecie'),
                adiantamentoContab=data.get('adiantamentoContab'),
                horasExtras=data.get('horasExtras'),
                assiduidade=data.get('assiduidade', 0),
                combustivel=data.get('combustivel', 0),
                cartaoAlimentacao=data.get('cartaoAlimentacao', 0),
                valeTransporte=data.get('valeTransporte'),
                emprestimo=data.get('emprestimo'),
                outros=data.get('outros'),
                liquidoTotal=data.get('liquidoTotal'),
                pagamentoContab=data.get('pagamentoContab'),
                pagamentoEspecie=data.get('pagamentoEspecie'),
                formaPagamento=data.get('formaPagamento', 'Depósito'),
                emprestimosPagos=json.dumps(data.get('emprestimosPagos', [])),
                faltas=json.dumps(data.get('faltas', [])),
                atestados=json.dumps(data.get('atestados', [])),
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

@app.route('/api/lancamentos/finalizar-todos', methods=['POST'])
def finalizar_todos_lancamentos():
    """Finaliza em lote os lançamentos em aberto cujos ids foram enviados."""
    ids = (request.get_json(silent=True) or {}).get('ids')
    if not isinstance(ids, list) or not ids:
        return jsonify({'erro': 'Nenhum lançamento informado.'}), 400
    ids = [str(i) for i in ids]
    abertos = Lancamento.query.filter(Lancamento.id.in_(ids), Lancamento.status == 'aberto').all()
    for l in abertos:
        l.status = 'finalizado'
    db.session.commit()
    return jsonify({'mensagem': 'Lançamentos finalizados', 'finalizados': len(abertos)}), 200

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