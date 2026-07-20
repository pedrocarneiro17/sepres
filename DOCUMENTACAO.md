# Documentação do Sistema DP (sepres)

Sistema web de Departamento Pessoal para cadastro de colaboradores e controle de
lançamentos mensais de pagamento (folha, adiantamentos, empréstimos, férias e
diárias), com dashboard de indicadores e gráficos.

## 1. Visão geral da arquitetura

- **Backend**: Flask + Flask-SQLAlchemy + Flask-Login (`app.py`), expõe uma API
  REST em `/api/*` e serve as páginas HTML de `templates/`.
- **Banco de dados**: **PostgreSQL em produção** (via variável de ambiente
  `DATABASE_URL`, fornecida automaticamente pelo Railway ao vincular o serviço de
  banco) ou **SQLite local** (`dados.db`) quando `DATABASE_URL` não está definida —
  usado para desenvolvimento na máquina do desenvolvedor. Não há migrações
  formais; o próprio `app.py` roda uma migração leve no boot (`ALTER TABLE ... ADD
  COLUMN`) para adicionar colunas novas a bancos já existentes, sem apagar dados.
- **Autenticação**: login por sessão com **Flask-Login**. Todo o sistema (páginas
  e API) fica atrás de um guard central (`before_request`) — só a tela de login e
  os arquivos estáticos ficam acessíveis sem sessão válida. As credenciais vêm de
  variáveis de ambiente (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), nunca do código.
- **Frontend**: HTML + **Tailwind CSS compilado** (sem CDN — gerado localmente via
  `npm run build:css` para `static/css/app.css`) + JavaScript puro
  (`static/js/main.js`), sem build de JS nem SPA. Um menu lateral retrátil
  substitui a navegação antiga do topo.
- **Gráficos**: **Chart.js**, instalado como dependência local e servido de
  `static/js/vendor/chart.umd.js` (também sem CDN).
- **Deploy**: `Procfile` usa `gunicorn app:app` (Railway). A porta é configurável
  via variável `PORT`.

## 2. Autenticação

- Tela de login em `/login` (usuário + senha), com sessão persistida via cookie
  assinado (`SECRET_KEY`).
- **Toda rota exige login** — páginas redirecionam para `/login?next=<rota>`;
  chamadas à API sem sessão retornam `401 Não autenticado`.
- O frontend intercepta qualquer resposta `401` de qualquer chamada e redireciona
  automaticamente para a tela de login (sessão expirada).
- Logout em `/logout`, acessível pelo rodapé do menu lateral.
- **Variáveis de ambiente relevantes**: `SECRET_KEY`, `ADMIN_USERNAME`,
  `ADMIN_PASSWORD`, `DATABASE_URL`. Em desenvolvimento local, um arquivo `.env`
  (não versionado) fornece valores fixos via `python-dotenv`; em produção essas
  variáveis são configuradas diretamente no Railway.

## 3. Modelo de dados

### 3.1 Colaborador (`Colaborador`)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | Gerado como timestamp em ms na criação. |
| `nome` | string | Obrigatório. |
| `cpf` | string | Obrigatório e **único** — validado no backend antes de salvar. Mascarado no formulário (`000.000.000-00`). |
| `endereco` | string | Livre. |
| `funcao` | string | Cargo/função, livre. |
| `empresa` | string | **`Engenharia`** ou **`Gerenciadora`** — define em qual CNPJ/empresa o colaborador está registrado. Determina as opções de contratação disponíveis (ver seção 5.1). |
| `contratacao` | string | `CLT`, `Diarista` ou `Mensalista` (Engenharia); apenas `CLT` (Gerenciadora). |
| `admissao` | string `YYYY-MM-DD` | Data de admissão. |
| `remuneracao` | float | Remuneração bruta/base (CLT e Mensalista). |
| `premio` | float | Prêmio/bonificação fixa. |
| `valorDiaria` | float | **Valor da diária** — usado apenas quando `contratacao = Diarista`; alimenta o cálculo automático do lançamento mensal. |
| `total` | float | Calculado no frontend como `remuneracao + premio` (readonly). |
| `valeRefeicao`, `valeTransporte` (benefício) | `Sim`/`Não` | Informativos — não entram em cálculo de folha. |
| `seguroVida` | `Ativo`/`Inativo` | Informativo. |
| `planoOdonto` | `Sim`/`Não` | Se `Sim`, exibe campo de dependentes. |
| `dependentes` | int | Relevante só se `planoOdonto = Sim`. |
| `temAdiantamento` | `Sim`/`Não` | Define se há adiantamento recorrente configurado. |
| `valorAdiantamento` | float | Valor do adiantamento recorrente. |
| `tipoAdiantamento` | `Espécie`/`Depósito` | Define para qual campo do lançamento mensal o adiantamento é pré-preenchido. |
| `observacoes` | texto livre | — |
| `emprestimos` | relação 1\:N | Ver seção 3.2. Excluído em cascata. |
| `lancamentos` | relação 1\:N | Ver seção 3.3. Excluído em cascata. |

### 3.2 Empréstimo (`Emprestimo`)

Empréstimo parcelado vinculado a um colaborador (pode haver vários por colaborador).

| Campo | Regra |
|---|---|
| `valor` | Valor total do empréstimo. |
| `parcelas` | Quantidade de parcelas (parcela nominal = `valor / parcelas`). |
| `inicio` | Mês/ano (`YYYY-MM`) da primeira parcela — via seletor de mês em português. |
| `descricao` | Texto livre; default `"Sem descrição"` se vazio. |

O **quanto já foi efetivamente pago** de cada empréstimo não é armazenado no
próprio empréstimo — é calculado somando o campo `emprestimosPagos` de todos os
lançamentos do colaborador (ver seção 3.3 e regra 5.4). Isso permite pagamento
parcial mês a mês sem exigir edição do cadastro do empréstimo.

**Regra de sincronização** (`update_or_create_emprestimos` em `app.py`): ao salvar
um colaborador, o backend compara os empréstimos recebidos no payload com os já
existentes — os que não vierem são **excluídos**, os que vierem com `id`
existente são atualizados, os sem `id` são criados.

### 3.3 Lançamento (`Lancamento`)

Registro de pagamento mensal de um colaborador.

| Campo | Regra |
|---|---|
| `colaboradorId` | FK obrigatória. |
| `mes` | `YYYY-MM`, obrigatório. |
| `ferias` | `Normal` ou `Férias` — quando `Férias`, todos os valores abaixo são zerados. |
| `diasTrabalhados` | Usado apenas quando o colaborador é `Diarista`; multiplicado por `valorDiaria` para calcular a remuneração do mês. |
| `remuneracao`, `bonificacao` | Pré-preenchidos a partir do cadastro (ou calculados, no caso de diarista), editáveis. |
| `totalRecebido` | Calculado = `remuneracao + bonificacao` (readonly). |
| `adiantamentoEspecie`, `adiantamentoContab` | Adiantamento do mês, dividido por forma. **Agora descontam do líquido** (ver 5.3). |
| `horasExtras` | Valor de horas extras do mês — soma no líquido. |
| `valeTransporte` | Valor monetário do VT do mês. |
| `emprestimo` | Soma dos valores pagos de empréstimo no mês — ver seção 5.4 (detalhamento editável por empréstimo). |
| `emprestimosPagos` | JSON `[{"id": <id do empréstimo>, "valor": <pago no mês>}]` — granularidade por empréstimo, permite pagamento parcial. |
| `outros` | Outros descontos/valores do mês. |
| `liquidoTotal` | Calculado = `totalRecebido + horasExtras − valeTransporte − emprestimo − outros − adiantamentoEspecie − adiantamentoContab` (readonly). |
| `pagamentoContab` | Valor pago via contabilidade/depósito. |
| `pagamentoEspecie` | Valor pago em espécie. Pré-preenchido com `remuneracao + premio`, editável. |
| `formaPagamento` | `Depósito`, `Espécie` ou **`Depósito + Espécie`**. |
| `status` | `aberto` (padrão) ou `finalizado`. |

## 4. API REST (`app.py`)

| Rota | Método | Auth | Função |
|---|---|---|---|
| `/login` | GET/POST | pública | Tela e processamento de login. |
| `/logout` | GET | logado | Encerra a sessão. |
| `/` | GET | logado | Dashboard. |
| `/colaboradores` | GET | logado | Página de gestão de colaboradores. |
| `/lancamentos` | GET | logado | Página de lançamentos mensais. |
| `/index.html`, `/colaboradores.html`, `/lancamentos.html` | GET | — | Redirecionam (301) para as rotas limpas acima — compatibilidade com links antigos. |
| `/api/dados` | GET | logado | Retorna `colaboradores` + `lancamentos` completos. |
| `/api/colaboradores` | GET/POST | logado | Lista / cria-edita colaborador (valida CPF único; sincroniza empréstimos). |
| `/api/colaboradores/<id>` | DELETE | logado | Exclui colaborador (cascade lançamentos e empréstimos). |
| `/api/lancamentos` | GET/POST | logado | Lista / cria-edita lançamento. |
| `/api/lancamentos/<id>` | DELETE | logado | Exclui lançamento. |
| `/api/lancamentos/<id>/finalizar` | PUT | logado | Muda status para `finalizado`. |
| `/api/lancamentos/<id>/reabrir` | PUT | logado | Muda status para `aberto`. |
| `/api/backup` | GET | logado | Dump completo somente leitura. |

**Removida nesta versão**: a antiga rota `/api/restaurar`, que apagava todas as
tabelas a partir de um JSON enviado pelo cliente sem qualquer proteção. Não existe
mais rota de restauração/reset de dados via API.

Qualquer chamada à API sem sessão válida retorna `401`; qualquer rota inexistente
retorna `404` (não há mais fallback que tentasse renderizar templates arbitrários).

## 5. Regras de negócio — detalhamento

### 5.1 Empresa define o tipo de contratação disponível

- **Engenharia**: permite `CLT`, `Diarista` ou `Mensalista`.
- **Gerenciadora**: permite apenas `CLT`.

O formulário de cadastro reconstrói as opções do campo "Tipo de Contratação"
automaticamente ao trocar a empresa selecionada.

### 5.2 Diarista: valor da diária × dias trabalhados

- No cadastro, ao escolher `Diarista`, aparece o campo **Valor da Diária**.
- No lançamento mensal, ao selecionar um colaborador diarista, aparece o bloco
  **Diária** com o valor (pré-preenchido do cadastro) e o campo **Dias
  Trabalhados**; a remuneração do mês é calculada automaticamente
  (`valorDiaria × diasTrabalhados`) a cada alteração.

### 5.3 Adiantamento desconta do líquido

Fórmula do líquido:

```
Líquido = Total Recebido + Horas Extras
          − Vale Transporte − Empréstimo − Outros
          − Adiantamento Espécie − Adiantamento Contabilidade
```

O recibo de pagamento gerado a partir de um lançamento mostra o **valor líquido**
(antes mostrava o pagamento em espécie, que podia ficar zerado/inconsistente).

### 5.4 Empréstimos: parcela sugerida, pagamento parcial e baixa automática

- Ao selecionar colaborador + mês no lançamento, o sistema lista, em um bloco
  **"Empréstimos deste mês"**, cada empréstimo ainda com saldo devedor,
  sugerindo o menor valor entre a parcela nominal (`valor / parcelas`) e o saldo
  restante.
- **Cada linha é editável**: se o colaborador pagou menos que a parcela num mês
  (ex.: parcela de R$ 250, pagou R$ 200), o valor lançado é o editado — a
  diferença permanece como saldo e volta a ser sugerida nos meses seguintes, até
  o valor total ser quitado.
- O campo "Empréstimo (total)" do lançamento é a soma dos valores das linhas.
- Um empréstimo **some da lista de sugestões** assim que a soma de tudo que foi
  pago (em todos os lançamentos) atingir o valor total — mas o empréstimo em si
  **nunca é apagado**, permanecendo no cadastro do colaborador como histórico.
- No cadastro do colaborador, cada empréstimo mostra: valor da parcela nominal,
  quanto já foi pago do total, e um badge de status — **"Saldo R$ X"** (âmbar,
  em andamento) ou **"Quitado"** (verde).

### 5.5 CPF único por colaborador

Validado no backend (`app.py`) antes de criar ou editar — bloqueia com `400` se
outro colaborador já usa o mesmo CPF.

### 5.6 Exclusão em cascata

Excluir um colaborador remove automaticamente todos os seus lançamentos e
empréstimos (constraint `cascade="all, delete-orphan"`).

### 5.7 Um lançamento por colaborador/mês (reforçado no frontend)

Ao escolher colaborador + mês, se já existir lançamento:
- **finalizado**: bloqueia e orienta reabrir antes de editar;
- **aberto**: avisa e carrega automaticamente para edição.

Essa validação ainda não existe na API — só na tela.

### 5.8 Férias zeram os valores do mês

Selecionar "Férias" no status do mês zera todos os campos monetários e desabilita
a edição, mas ainda grava um lançamento (para constar no histórico e nos
indicadores de férias do dashboard).

### 5.9 Forma de pagamento

Agora com três opções: `Depósito`, `Espécie` ou `Depósito + Espécie` — persistida
corretamente no banco (anteriormente esse campo existia na tela mas era
descartado antes de chegar ao backend; foi corrigido).

## 6. Funcionalidades por página

### 6.1 Dashboard (`/`)

- **Uma única linha de filtros** que controla indicadores, gráficos e a tabela de
  detalhamento simultaneamente:
  - **Competência**: "Todos os meses" ou "Mês específico" (com seletor de mês em
    português).
  - **Tipo de Contrato**: Todos / CLT / Diarista / Mensalista.
  - **Empresa (CNPJ)**: Todas / Engenharia / Gerenciadora.
- **4 indicadores**: Colaboradores, Líquido Pago, Adiantamentos, Empréstimos —
  todos recalculados de acordo com os filtros ativos.
- **6 gráficos** (Chart.js, todos de série única em uma só cor, com destaque por
  emphasis quando aplicável):
  1. **Líquido pago por empresa (CNPJ)** — total pago por Engenharia/Gerenciadora.
  2. **Evolução mensal do líquido** — sempre mostra todos os meses; se uma
     competência específica estiver filtrada, aquele mês aparece destacado em
     cor e os demais em cinza (contexto histórico).
  3. **Líquido pago por tipo de contrato**.
  4. **Colaboradores por tipo de contrato** (contagem/headcount).
  5. **Composição dos descontos** (adiantamentos, empréstimos, vale-transporte,
     outros).
  6. **Férias por mês** — quantidade de colaboradores em férias em cada mês,
     com o mesmo destaque do mês filtrado.
- **Tabela de detalhamento** alternável entre Colaboradores e Lançamentos,
  refletindo os mesmos filtros.
- Atalhos para editar colaborador/lançamento diretamente a partir das tabelas.

### 6.2 Colaboradores (`/colaboradores`)

- Formulário único de cadastro/edição, com seções: Dados Pessoais, Dados
  Profissionais (incluindo Empresa e Contratação dependente dela), Remuneração
  (com campo de Diária quando aplicável), Benefícios, Adiantamento, Empréstimos,
  Observações.
- CPF com máscara automática; campos monetários com máscara em formato
  brasileiro (milhar com ponto, decimal com vírgula, prefixo "R$").
- **Ao salvar, o colaborador permanece na tela** em modo de edição (não limpa o
  formulário) — facilita conferência e ajustes subsequentes.
- **Enter no formulário não salva** — salvar só ocorre pelo clique no botão
  "Salvar Colaborador" (evita salvamentos acidentais).
- Notificações e confirmações usam componentes próprios do sistema (toast e
  modal), não mais os diálogos genéricos do navegador.
- Busca por nome na listagem.
- Múltiplos empréstimos por colaborador, cada um com valor, parcelas, mês de
  início (seletor em português), descrição, valor da parcela e status de
  pagamento (ver 5.4).

### 6.3 Lançamentos (`/lancamentos`)

- Preenchimento automático ao escolher colaborador + mês (remuneração, diária ×
  dias se aplicável, adiantamento configurado, bloco de empréstimos do mês).
- Detecção de lançamento existente no mês (ver 5.7).
- Bloco de Diária (quando aplicável), cálculos automáticos de Total Recebido e
  Líquido Total.
- Bloco de Empréstimos do mês com valor editável por empréstimo (ver 5.4).
- Ciclo de vida do lançamento: `aberto` → `finalizado` → pode `reabrir`.
- **Busca por nome do colaborador** na listagem de lançamentos, além do filtro de
  mês usado para exportação.
- Geração de recibo (mostra o valor líquido) e exportação CSV por mês.

## 7. Frontend — componentes reaproveitáveis

- **Máscaras**: `.money` (valores em formato brasileiro) e `.cpf`, aplicadas por
  delegação de evento a qualquer campo com essas classes, incluindo os criados
  dinamicamente (empréstimos).
- **Select customizado**: todo `<select class="input">` é automaticamente
  substituído por um dropdown arredondado e estilizado (o `<select>` nativo
  permanece oculto como fonte de dados, preservando toda a lógica existente).
- **Seletor de mês em português**: substitui o `<input type="month">` nativo
  (que exibe em inglês) por um seletor com nomes de mês em PT-BR e navegação por
  ano.
- **Notificações (toast)** e **modal de confirmação**: substituem `alert()` e
  `confirm()` do navegador.
- **Menu lateral retrátil**: expande/recolhe (ícone apenas), com estado
  persistido em `localStorage`; em telas pequenas vira menu hambúrguer deslizante.

## 8. Scripts e ferramentas de suporte

- `npm run build:css` / `npm run watch:css` — compila `static/css/input.css`
  (Tailwind) para `static/css/app.css`, que é o arquivo referenciado pelas
  páginas. Necessário rodar após qualquer alteração de classes/estilo.
- `seed_demo.py` — popula o banco com dados de demonstração (colaboradores nas
  duas empresas, nos três tipos de contrato, lançamentos de 6 meses, férias e um
  empréstimo). Todos os registros ficam marcados internamente; `python
  seed_demo.py --limpar` remove somente esses registros, nunca dados reais.
- `.env.example` — modelo das variáveis de ambiente (`SECRET_KEY`,
  `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_URL`).

## 9. Pontos de atenção conhecidos

- **Duplicidade de lançamento (colaborador + mês)** é impedida apenas na
  interface; a API não tem essa validação — uma chamada direta a
  `POST /api/lancamentos` pode, em tese, criar duplicatas.
- **IDs gerados por timestamp em milissegundos** (`Colaborador`, `Lancamento`)
  podem colidir em cenários de alta concorrência; `Emprestimo` mitiga isso com
  bytes aleatórios adicionais.
- **Sessão única de administrador**: não há múltiplos usuários/perfis — todo
  acesso ao sistema usa a mesma credencial administrativa.
- Campos cadastrais `valeRefeicao`, `valeTransporte` (do colaborador),
  `seguroVida`, `planoOdonto`, `dependentes` continuam sem afetar cálculos de
  folha — são informativos.
