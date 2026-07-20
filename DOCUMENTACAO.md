# Documentação do Sistema DP (sepres)

Sistema web de Departamento Pessoal para cadastro de colaboradores e controle de
lançamentos mensais de pagamento (folha, adiantamentos, empréstimos e férias).

## 1. Visão geral da arquitetura

- **Backend**: Flask + Flask-SQLAlchemy (`app.py`), expõe uma API REST em `/api/*`
  e serve as páginas HTML de `templates/`.
- **Banco de dados**: SQLite (`dados.db`), criado automaticamente na primeira
  execução (`db.create_all()`). Não há migrações — qualquer mudança de schema
  exige apagar o arquivo `dados.db` ou migrar manualmente.
- **Frontend**: HTML + Bootstrap 5 + JavaScript puro (`static/js/main.js`), sem
  build step, sem framework SPA. Cada página (`index.html`, `colaboradores.html`,
  `lancamentos.html`) carrega o mesmo `main.js`, que decide o que renderizar
  com base no `pathname` da URL.
- **Deploy**: `Procfile` usa `gunicorn app:app` (ex.: Railway/Heroku). Há um
  comentário explícito no código alertando que o SQLite é **efêmero** nesses
  ambientes de contêiner — os dados são perdidos a cada novo deploy/restart,
  a menos que um volume persistente seja configurado.
- **Segurança**: CORS liberado para qualquer origem (`CORS(app)` sem restrição)
  e **nenhuma autenticação/autorização** existe em nenhuma rota. Qualquer
  pessoa com acesso à URL pode ler, criar, editar ou apagar todos os dados.

## 2. Modelo de dados

### 2.1 Colaborador (`Colaborador`)
Tabela principal de funcionários/prestadores.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | Gerado como timestamp em ms (`str(int(datetime.now().timestamp()*1000))`) na criação. |
| `nome` | string | Obrigatório no formulário (`required`). |
| `cpf` | string | Obrigatório e **único** — validado no backend antes de salvar. |
| `endereco` | string | Livre. |
| `funcao` | string | Cargo/função, livre. |
| `contratacao` | string | `CLT`, `Mensalista` ou `Autônomo` (opções do `<select>`). |
| `admissao` | string `YYYY-MM-DD` | Data de admissão. |
| `remuneracao` | float | Remuneração bruta/base. |
| `premio` | float | Prêmio/bonificação fixa. |
| `total` | float | Calculado no frontend como `remuneracao + premio` (readonly). |
| `valeRefeicao` | `Sim`/`Não` | Apenas informativo — **não** entra em nenhum cálculo de folha. |
| `valeTransporte` | `Sim`/`Não` | Idem — é um benefício cadastral, distinto do campo `valeTransporte` do lançamento mensal (que é um valor monetário). |
| `seguroVida` | `Ativo`/`Inativo` | Apenas informativo. |
| `planoOdonto` | `Sim`/`Não` | Se `Sim`, exibe campo de dependentes. |
| `dependentes` | int | Só relevante se `planoOdonto = Sim`. |
| `temAdiantamento` | `Sim`/`Não` | Define se o colaborador tem adiantamento recorrente configurado. |
| `valorAdiantamento` | float | Valor do adiantamento recorrente. |
| `tipoAdiantamento` | `Espécie`/`Depósito` | Define para qual campo do lançamento mensal o adiantamento é pré-preenchido. |
| `observacoes` | texto livre | — |
| `emprestimos` | relação 1\:N | Ver seção 2.2. Excluído em cascata (`cascade="all, delete-orphan"`). |
| `lancamentos` | relação 1\:N | Ver seção 2.3. Excluído em cascata. |

### 2.2 Empréstimo (`Emprestimo`)
Empréstimo parcelado vinculado a um colaborador (um colaborador pode ter vários).

| Campo | Regra |
|---|---|
| `valor` | Valor total do empréstimo. |
| `parcelas` | Quantidade de parcelas (valor da parcela = `valor / parcelas`). |
| `inicio` | Mês/ano (`YYYY-MM`) da primeira parcela. |
| `descricao` | Texto livre (ex.: "Emergência médica"); default `"Sem descrição"` se vazio. |

**Regra de sincronização (`update_or_create_emprestimos` em `app.py`)**: ao salvar
um colaborador, o backend compara os empréstimos recebidos no payload com os já
existentes no banco — os que não vierem no payload são **excluídos**, os que
vierem com `id` existente são atualizados, e os sem `id` (ou com `id` novo) são
criados com um ID gerado por timestamp + bytes aleatórios.

### 2.3 Lançamento (`Lancamento`)
Registro de pagamento mensal de um colaborador. Um lançamento é identificado
pela combinação (colaborador, mês) — mas essa unicidade é garantida apenas na
camada de frontend (ver seção 4.3), **não** há constraint de unicidade no banco.

| Campo | Regra |
|---|---|
| `colaboradorId` | FK obrigatória. |
| `mes` | `YYYY-MM`, obrigatório. |
| `ferias` | `Normal` ou `Férias` — quando `Férias`, todos os valores abaixo são zerados. |
| `remuneracao`, `bonificacao` | Pré-preenchidos a partir do cadastro do colaborador, editáveis. |
| `totalRecebido` | Calculado = `remuneracao + bonificacao` (readonly). |
| `adiantamentoEspecie`, `adiantamentoContab` | Adiantamento do mês, dividido por forma. |
| `horasExtras` | Valor de horas extras do mês. |
| `valeTransporte` | Valor monetário do VT do mês (distinto do campo booleano do cadastro). |
| `emprestimo` | Soma das parcelas de empréstimos que vencem naquele mês (calculado automaticamente, mas editável). |
| `outros` | Outros descontos/valores do mês. |
| `liquidoTotal` | Calculado = `totalRecebido + horasExtras - valeTransporte - emprestimo - outros` (readonly). |
| `pagamentoContab` | Valor pago via contabilidade/depósito (não entra na fórmula do líquido, mas é lançado). |
| `pagamentoEspecie` | Valor pago em espécie. Pré-preenchido com `remuneracao + premio` do colaborador, mas **não recalculado automaticamente** depois — fica fixo no que o usuário digitar/ajustar. |
| `status` | `aberto` (padrão) ou `finalizado`. |

## 3. API REST (`app.py`)

| Rota | Método | Função | Regras |
|---|---|---|---|
| `/` | GET | Serve `index.html` | Dashboard. |
| `/<path>.html` | GET | Serve páginas HTML | Qualquer `.html` em `templates/`. |
| `/<path>` (outros) | GET | Serve arquivo estático | De `static/`. |
| `/api/dados` | GET | Retorna `colaboradores` + `lancamentos` completos | Usado no carregamento inicial de todas as páginas. |
| `/api/colaboradores` | GET | Lista colaboradores (com empréstimos aninhados) | — |
| `/api/colaboradores` | POST | Cria ou edita colaborador | Se `data.id` vazio → cria; senão → edita. Rejeita com `400` se CPF já pertence a outro `id`. Sincroniza empréstimos. |
| `/api/colaboradores/<id>` | DELETE | Exclui colaborador | Cascade apaga lançamentos e empréstimos associados. `404` se não existir. |
| `/api/lancamentos` | GET | Lista todos os lançamentos | — |
| `/api/lancamentos` | POST | Cria ou edita lançamento | Mesma lógica de `id` vazio = criação. **Não valida duplicidade de (colaborador+mês) no backend.** |
| `/api/lancamentos/<id>` | DELETE | Exclui lançamento | `404` se não existir. |
| `/api/lancamentos/<id>/finalizar` | PUT | Muda `status` para `finalizado` | Sem outras validações (não confere se campos estão completos). |
| `/api/lancamentos/<id>/reabrir` | PUT | Muda `status` para `aberto` | Permite reeditar um lançamento finalizado. |
| `/api/backup` | GET | Retorna dump completo (colaboradores + lançamentos) | Idêntico a `/api/dados`, mantido por compatibilidade. |
| `/api/restaurar` | POST | Restaura dados de um JSON | **Apaga todas as tabelas** (`Lancamento`, `Emprestimo`, `Colaborador`) antes de inserir os novos dados. Comentário no código diz "APENAS PARA TESTES" — está exposto publicamente sem proteção. |

## 4. Funcionalidades por página

### 4.1 Dashboard (`index.html`)
- Alterna entre visão **Colaboradores** e **Lançamentos** via filtro "Visualizar".
- Filtros: mês/ano (default = mês atual), colaborador (só aparece no modo
  Lançamentos) e tipo de visão.
- Cards de estatística:
  - **Colaboradores**: contagem total (não filtrada por mês).
  - **Lançamentos**: contagem já filtrada por mês/colaborador selecionados.
  - **Adiantamento**: soma de `adiantamentoEspecie + adiantamentoContab` dos lançamentos filtrados.
  - **Líquido Espécie**: `soma(pagamentoEspecie) - totalAdiantamento` dos lançamentos filtrados.
  - **Total**: `totalAdiantamento + soma(pagamentoEspecie)`.
- Tabela de colaboradores no dashboard tem apenas ação de "editar" (ícone de
  olho, mas na verdade redireciona para o formulário de edição em
  `colaboradores.html?editar=<id>`).
- Tabela de lançamentos no dashboard: se `status = finalizado`, o botão abre em
  modo somente leitura (`visualizarLancamento`); se `aberto`, redireciona para
  edição em `lancamentos.html?editar=<id>`.
- Exclusão de colaborador é feita via modal de confirmação, que avisa que
  lançamentos/empréstimos vinculados também serão apagados.

### 4.2 Colaboradores (`colaboradores.html`)
- Formulário único para cadastro e edição (`colabEditId` vazio = criação).
- **Total** é somado automaticamente (`remuneracao + premio`) a cada digitação,
  campo readonly.
- **Plano Odontológico = Sim** revela o campo "Quantos Dependentes?".
- **Possui Adiantamento = Sim** revela "Valor do Adiantamento" e "Tipo de
  Adiantamento" (Espécie/Depósito).
- **Empréstimos**: botão "Adicionar Empréstimo" cria dinamicamente um bloco
  com valor, parcelas, mês de início e descrição; pode haver múltiplos por
  colaborador; cada um pode ser removido individualmente antes de salvar.
  Só é enviado ao backend se `valor > 0` e `inicio` preenchido.
- Ao salvar:
  - **Regra de negócio crítica**: CPF duplicado (outro colaborador com o
    mesmo CPF) é bloqueado com mensagem "CPF já cadastrado!" (HTTP 400).
  - Após salvar (criação ou edição), o formulário é sempre limpo.
- Lista de colaboradores com busca por nome (filtro client-side, `onkeyup`).
- Cor do badge de contratação: `CLT` = azul (primary), `Mensalista` = verde
  (success), qualquer outro (`Autônomo`) = azul claro (info).
- Exclusão exige confirmação via modal, alertando que é uma ação **irreversível**
  que também apaga lançamentos e empréstimos vinculados.

### 4.3 Lançamentos (`lancamentos.html`)
- Formulário de lançamento mensal, com verificação em tempo real ao escolher
  colaborador + mês:
  - **Se já existe lançamento `finalizado`** para aquele colaborador/mês →
    bloqueia, exibe alerta pedindo para reabrir o lançamento na lista antes de
    editar, e limpa os campos selecionados.
  - **Se já existe lançamento `aberto`** → avisa o usuário e carrega
    automaticamente os dados existentes para edição (evita duplicar
    lançamento no mesmo mês).
  - **Se não existe lançamento** → preenche automaticamente os campos com
    base no cadastro do colaborador (ver regra de auto-preenchimento abaixo)
    e calcula as parcelas de empréstimo do mês.
- **Regra de auto-preenchimento de adiantamento** (`preencherCamposAutomaticamente`):
  só ocorre se `colaborador.temAdiantamento === 'Sim'` e `valorAdiantamento > 0`.
  - Se `contratacao === 'CLT'`: o valor vai para **Adiantamento Espécie** se
    `tipoAdiantamento === 'Espécie'`, senão vai para **Adiantamento
    Contabilidade** (cobre também o caso `Depósito`).
  - Se `contratacao !== 'CLT'` (Mensalista/Autônomo, e também trata um valor
    legado `'Diarista'` que não existe mais no `<select>` do cadastro): o
    adiantamento sempre vai para **Adiantamento Espécie**.
  - **Pagamento Espécie** é sempre pré-preenchido com `remuneracao + premio`
    do colaborador, independente do tipo de contratação.
- **Cálculo de parcelas de empréstimo do mês** (`calcularEmprestimosDoMes`):
  para cada empréstimo do colaborador, verifica se o mês do lançamento cai
  dentro da janela `[inicio, inicio + parcelas - 1 meses]`; se sim, soma
  `valor / parcelas` ao campo Empréstimo e lista o detalhamento
  ("descrição: parcela atual/total - R$ valor") abaixo do campo.
- **Modo Férias**: selecionar "Férias" no campo Status do Mês esconde todos os
  campos de valores, zera todos eles, e exibe um aviso informando que os
  valores são zerados automaticamente. Ao salvar, um lançamento é gravado com
  todos os valores monetários em `0` e `ferias = 'Férias'`.
- **Cálculos automáticos** (recalculados a cada `input` nos campos):
  - `Total Recebido = Remuneração + Prêmio`.
  - `Líquido Total = Total Recebido + Horas Extras − Vale Transporte − Empréstimo − Outros`.
  - `Pagamento Espécie` **não** é recalculado automaticamente a partir do
    líquido — fica fixo no valor preenchido/editado manualmente.
- **Status do lançamento**:
  - `aberto`: pode ser editado, finalizado ou excluído.
  - `finalizado`: só pode ser visualizado (somente leitura), reaberto, ou usado
    para gerar um recibo de pagamento.
- **Recibo de pagamento**: gerado a partir de um lançamento (tipicamente
  finalizado), mostra nome, CPF, valor de `pagamentoEspecie`, data atual e mês
  de referência; abre em nova janela e aciona a impressão do navegador
  automaticamente.
- **Exportação CSV**: exporta os lançamentos de um mês selecionado com colunas
  `Nome; Adiantamento Contabilidade; Adiantamento Espécie; Pagamento
  Contabilidade; Pagamento Espécie`, separador `;`, decimal com vírgula, BOM
  UTF-8 (para abrir corretamente no Excel). Bloqueia exportação se nenhum mês
  for selecionado ou se não houver lançamentos naquele mês.

## 5. Regras de negócio — resumo consolidado

1. **CPF é único por colaborador** (validação no backend, `app.py:227-233`).
2. **Excluir colaborador exclui em cascata** todos os seus lançamentos e
   empréstimos (constraint `cascade="all, delete-orphan"` no SQLAlchemy).
3. **Um lançamento por colaborador/mês é reforçado apenas no frontend** —
   ao detectar duplicidade, o formulário intercepta antes do envio; a API
   não tem essa validação, então é possível burlar via chamada direta à API.
4. **Lançamento finalizado é protegido de edição direta** — precisa ser
   reaberto (`PUT /reabrir`) antes de poder ser salvo novamente. A finalização
   não faz nenhuma validação de completude dos dados.
5. **Férias zera todos os valores monetários do mês** e ainda assim grava um
   registro de lançamento (para constar no histórico/contagem do mês).
6. **Adiantamento no lançamento mensal segue o tipo de contratação e o tipo de
   adiantamento cadastrado** no colaborador (Espécie vs. Contabilidade/Depósito).
7. **Empréstimos são rateados automaticamente mês a mês** com base na data de
   início e quantidade de parcelas — sem necessidade de lançar manualmente a
   parcela todo mês.
8. **Líquido Total é uma fórmula fixa**: recebido + horas extras − VT −
   empréstimo − outros. Pagamento Espécie **não** faz parte dessa fórmula, é
   um valor paralelo que só é sugerido, nunca imposto.

## 6. Inconsistências e pontos de atenção identificados na revisão

Estes pontos não impedem o funcionamento atual, mas são riscos ou "dívidas"
que vale registrar:

- **`lancFormaPagamento`** existe como campo no formulário HTML
  (`lancamentos.html:180`), mas **não é lido nem enviado** em
  `salvarLancamento()` (`main.js`) — o valor selecionado pelo usuário é
  descartado silenciosamente e nunca persistido.
- **`contratacao === 'Diarista'`** é tratado em `preencherCamposAutomaticamente`
  (`main.js:409`), mas essa opção **não existe** no `<select>` de
  `colaboradores.html` (só `CLT`, `Mensalista`, `Autônomo`) — código morto /
  possível resquício de uma versão anterior do formulário.
- **Sem validação de unicidade de (colaborador, mês) no backend** — a
  proteção contra lançamentos duplicados existe só na UI; qualquer chamada
  direta a `POST /api/lancamentos` pode criar duplicatas.
- **Rota `/api/restaurar` é destrutiva e pública** — apaga todas as tabelas
  sem qualquer autenticação, autorização ou confirmação server-side. O
  comentário no código já sinaliza "APENAS PARA TESTES", mas está acessível
  em produção.
- **Nenhuma autenticação/autorização** em nenhum endpoint — qualquer pessoa
  com a URL pode ler, alterar ou apagar todos os dados de colaboradores e
  folha de pagamento.
- **SQLite em ambiente de contêiner é efêmero** (comentário do próprio autor
  em `app.py:11`) — em plataformas como Railway, um redeploy apaga o banco,
  a menos que um volume persistente seja anexado.
- **Campos cadastrais `valeRefeicao`, `valeTransporte` (do colaborador),
  `seguroVida`, `planoOdonto`, `dependentes`** são armazenados mas não afetam
  nenhum cálculo de folha — são puramente informativos hoje.
- **IDs gerados por timestamp em milissegundos** (`Colaborador`, `Lancamento`)
  podem colidir em cenários de alta concorrência (dois registros criados no
  mesmo milissegundo); `Emprestimo` mitiga isso adicionando bytes aleatórios,
  mas os outros dois não.
- **README.md está vazio/corrompido** (apenas o texto `# sepres` malformado) —
  não descreve o projeto.
