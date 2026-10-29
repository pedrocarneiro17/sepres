# Documentação do Sistema DP (sepres)

Sistema web de Departamento Pessoal da SEPRES para cadastro de colaboradores e
controle de lançamentos mensais de pagamento (adiantamentos, empréstimos, férias,
diárias e recibos), com dashboard de indicadores e gráficos.

> Atualizada em 27/10/2026 com as regras vigentes. Onde uma regra mudou ao longo do
> desenvolvimento, aqui consta apenas a versão atual.

## 1. Visão geral da arquitetura

- **Backend**: Flask + Flask-SQLAlchemy + Flask-Login (`app.py`). Expõe uma API REST
  em `/api/*` e serve as páginas HTML de `templates/`.
- **Banco de dados**: **PostgreSQL em produção** (variável `DATABASE_URL`, fornecida
  pelo Railway) ou **SQLite local** (`dados.db`, ignorado pelo Git) quando
  `DATABASE_URL` não existe. Não há migrações formais: o `app.py` roda no boot uma
  migração leve e idempotente (`ALTER TABLE ... ADD COLUMN`) que adiciona colunas novas
  sem apagar dados. A URL do banco é normalizada para o driver `psycopg2`.
- **Conexão com o Postgres**: `pool_pre_ping` e `pool_recycle=280` evitam o erro
  `SSL SYSCALL error: EOF detected` quando o Railway derruba conexões ociosas.
- **Frontend**: HTML + **Tailwind CSS compilado** (sem CDN; `npm run build:css` gera
  `static/css/app.css`) + JavaScript puro (`static/js/main.js`). Fonte dos títulos:
  Metropolis (via jsDelivr/Fontsource); texto: Inter. Menu lateral retrátil.
- **Gráficos**: Chart.js local em `static/js/vendor/chart.umd.js`.
- **Planilhas**: `openpyxl` gera o arquivo Excel de exportação.
- **Deploy**: `Procfile` → `gunicorn app:app --capture-output --access-logfile - --log-level info`
  (Railway). Os logs do app saem no stderr.

## 2. Acesso, usuários e segurança

### 2.1 Login por e-mail

- O login é feito com **e-mail + senha** em `/login`. Não existe mais usuário padrão
  (`admin`) nem variáveis `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_EMAIL`.
- Os usuários ficam na tabela `usuario` (`username` interno, `email` único, senha com
  hash). **Dois usuários não podem ter o mesmo e-mail.**
- **Criar/atualizar usuário** (rodar com acesso ao banco de produção):
  `python criar_usuario.py <nome> <email> <senha>` — se o e-mail do nome já existir,
  atualiza e-mail e senha. `python criar_usuario.py --zerar` apaga **todos** os usuários
  (pede para digitar `APAGAR`).
- **Minha conta** (`/conta`, menu lateral): cada usuário cadastra/troca o próprio e-mail
  e a senha (exige a senha atual). O e-mail é obrigatório, pois é o login.

### 2.2 Recuperação de senha por e-mail

- Na tela de login, **"Esqueci minha senha"** (`/esqueci-senha`): informa o e-mail e
  recebe um link `/redefinir-senha/<token>`.
- O link vale **30 minutos**, serve **uma única vez** e é guardado no banco só como
  hash. A tela responde igual exista o e-mail ou não (não revela cadastros).
- Envio via **SMTP** (variáveis abaixo). Sem `SMTP_HOST`, o link só é escrito no log.
  O envio é feito em segundo plano; o log mostra `[email enviado]` ou
  `[erro ao enviar e-mail]`.
- Quem tem acesso à caixa de saída da conta remetente ou ao Railway consegue ver links
  e redefinir senhas: mantenha esses acessos com o responsável da SEPRES.

### 2.3 Proteções

- **Toda rota exige login**, exceto login, "esqueci a senha", redefinição e os arquivos
  estáticos. Páginas redirecionam para `/login?next=<rota>`; a API devolve `401`. O
  frontend redireciona para o login ao receber qualquer `401`.
- **Limite de tentativas** (em memória, por processo): login bloqueia após 5 falhas por
  e-mail ou 20 por IP em 15 min (`429`); "esqueci a senha" aceita 3 pedidos por e-mail e
  10 por IP por hora (acima disso responde igual, mas não envia).
- **XSS**: todo texto vindo de dados (nome, cargo, CPF, observações, descrições) é
  escapado (`esc()` em `main.js`) antes de entrar em `innerHTML`.
- **Cookies**: `HttpOnly`, `SameSite=Lax` e `Secure` em produção; "lembrar de mim" dura
  7 dias.
- **Cabeçalhos**: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS (em HTTPS) e `Cache-Control: no-store` nas páginas e na API.
  O CSP ainda permite scripts inline (o front-end usa `onclick` e blocos de script).
- **CORS**: removido (o front-end é servido pela própria origem).
- **SQL injection**: não há ponto de injeção conhecido — consultas via ORM; o único SQL
  manual são as migrações de coluna, com texto fixo.

### 2.4 Variáveis de ambiente

| Variável | Uso |
|---|---|
| `SECRET_KEY` | **Obrigatória em produção.** Assina as sessões. Sem ela, uma chave nova é gerada a cada reinício e as sessões caem. |
| `DATABASE_URL` | Banco PostgreSQL (Railway). Ausente = SQLite local. Em produção também liga o cookie `Secure`. |
| `SMTP_HOST`, `SMTP_PORT` | Servidor de e-mail (ex.: `smtp.gmail.com` / `587`; porta 465 usa SSL). |
| `SMTP_USER`, `SMTP_PASSWORD` | Conta remetente (no Gmail: **senha de app**, exige verificação em duas etapas). |
| `SMTP_FROM` | Remetente exibido, ex.: `Sistema DP SEPRES <conta@gmail.com>`. Importante para a entrega não cair em spam. |
| `APP_URL` | Endereço público do sistema, usado nos links do e-mail. |
| `PORT` | Porta do servidor (padrão 5000 local). |

## 3. Modelo de dados

### 3.1 Colaborador (`Colaborador`)

| Campo | Regra |
|---|---|
| `id` | Timestamp em ms, gerado na criação. |
| `nome`, `cpf` | Obrigatórios; **CPF único** (validado antes de salvar). |
| `endereco`, `funcao` | Livres (`funcao` = cargo). |
| `empresa` | `Engenharia` ou `Gerenciadora`. Define as contratações disponíveis (ver 5.1). |
| `contratacao` | `CLT`, `Diarista` ou `Mensalista` (Engenharia); só `CLT` (Gerenciadora). |
| `admissao` | `YYYY-MM-DD`. |
| `remuneracao` | Remuneração bruta/base (CLT e Mensalista). |
| `premio` | Prêmio fixo (existe para CLT e Mensalista; Diarista não tem). |
| `valorDiaria` | Valor da diária (só Diarista). |
| `total` | `remuneracao + premio` (informativo; não desconta adiantamento nem empréstimo). |
| `valeRefeicao`, `valeTransporte`, `seguroVida`, `planoOdonto`, `dependentes` | Informativos; não entram em cálculo. |
| `temAdiantamento`, `valorAdiantamento`, `tipoAdiantamento` | Adiantamento **padrão** do colaborador (ver 5.4). `tipoAdiantamento` = `Espécie` ou `Depósito` (Depósito só para CLT). |
| `contratos` | Lista de **períodos de contrato** (Mensalista/Diarista), guardada em `contratosJson`. Ver 5.2. |
| `observacoes` | Texto livre. |
| `emprestimos`, `lancamentos` | Relações 1:N, excluídas em cascata. |

As colunas antigas `fimContrato` e `desligado` continuam no banco só por compatibilidade:
no primeiro boot, quem tinha Fim de Contrato foi convertido em um período
(admissão → fim). Não são mais usadas.

### 3.2 Empréstimo (`Emprestimo`)

Empréstimo parcelado de um colaborador (pode haver vários): `valor`, `parcelas`
(parcela nominal = `valor / parcelas`), `inicio` (`YYYY-MM`) e `descricao`. O que já foi
pago não fica no empréstimo: é a soma de `emprestimosPagos` de todos os lançamentos do
colaborador (ver 5.6). Ao salvar o colaborador, os empréstimos que não vierem no payload
são excluídos, os com `id` são atualizados e os sem `id` são criados.

### 3.3 Lançamento (`Lancamento`)

Pagamento mensal de um colaborador (um por colaborador/mês).

| Campo | Regra |
|---|---|
| `colaboradorId`, `mes` | Obrigatórios (`mes` = `YYYY-MM`). |
| `ferias` | `Normal` ou `Férias` (Férias zera os valores). |
| `diasTrabalhados` | Só Diarista: multiplica `valorDiaria` para formar a remuneração. |
| `remuneracao`, `bonificacao` | Vêm do cadastro (ou diária × dias), editáveis. |
| `assiduidade`, `combustivel`, `cartaoAlimentacao`, `horasExtras` | Valores do mês. Assiduidade, Combustível e Horas Extras compõem o EVA do CLT (com o prêmio). |
| `adiantamentoEspecie`, `adiantamentoContab` | Adiantamento do mês (Contab. só CLT). Ver 5.4. |
| `valeTransporte`, `outros`, `emprestimo`, `emprestimosPagos` | VT, outros e empréstimo (ver 5.6). |
| `pagamentoContab` | Valor pago pela contabilidade (CLT: **"Pagamento Contab."**) ou **pago em conta** (Mensalista/Diarista: **"Pagamento em conta"**). Mesmo campo, só o rótulo muda. |
| `pagamentoEspecie` | Valor pago em espécie. |
| `liquidoTotal` | Calculado na tela conforme o tipo (ver 5.3). |
| `faltas`, `atestados` | Listas (JSON) de datas, observações e dias. |
| `formaPagamento` | `Depósito`, `Espécie` ou `Depósito + Espécie`. |
| `status` | `aberto` (padrão) ou `finalizado`. |

## 4. Rotas

| Rota | Método | Auth | Função |
|---|---|---|---|
| `/login` | GET/POST | pública | Login por e-mail. |
| `/esqueci-senha` | GET/POST | pública | Pede o link de redefinição. |
| `/redefinir-senha/<token>` | GET/POST | pública (token) | Define a nova senha. |
| `/conta` | GET/POST | logado | Minha conta (e-mail e senha). |
| `/logout` | GET | logado | Encerra a sessão. |
| `/`, `/colaboradores`, `/lancamentos` | GET | logado | Páginas (as `.html` antigas redirecionam). |
| `/api/dados` | GET | logado | Colaboradores + lançamentos. |
| `/api/colaboradores` | GET/POST | logado | Lista / cria-edita (valida CPF único e períodos de contrato). |
| `/api/colaboradores/<id>` | DELETE | logado | Exclui (cascata). |
| `/api/lancamentos` | GET/POST | logado | Lista / cria-edita. |
| `/api/lancamentos/<id>` | DELETE | logado | Exclui. |
| `/api/lancamentos/<id>/finalizar` | PUT | logado | Status → `finalizado`. |
| `/api/lancamentos/<id>/reabrir` | PUT | logado | Status → `aberto`. |
| `/api/lancamentos/finalizar-todos` | POST | logado | Finaliza em lote os `ids` enviados que estão em aberto. |
| `/api/exportar-planilha?mes=YYYY-MM&tipo=` | GET | logado | Planilha Excel de pagamentos do mês (ver 5.9). |
| `/api/exportar-colaboradores` | GET | logado | Planilha Excel de colaboradores (ver 5.9). |
| `/api/backup` | GET | logado | Dump completo, somente leitura. |

Não existe rota de restauração/reset de dados. Rota inexistente retorna `404`.

## 5. Regras de negócio

### 5.1 Empresa define a contratação disponível

- **Engenharia**: `CLT`, `Diarista` ou `Mensalista`.
- **Gerenciadora**: somente `CLT`.

O campo "Tipo de Contratação" é reconstruído ao trocar a empresa.

### 5.2 Períodos de contrato (Mensalista e Diarista)

- Cada colaborador de contrato por prazo tem uma **lista de períodos** (início e fim),
  podendo ter vários, com intervalos entre eles (ex.: 3 meses, 2 fora, 3 de novo).
  **Fim vazio = contrato em aberto.** Na tela são linhas "início até fim" com lixeira
  (a remoção pede confirmação e só vale ao salvar).
- O colaborador **só aparece no select de Lançamentos nos meses cobertos** por algum
  período. Contrato que termina em março: aparece em março, não em abril. Meses
  passados em que ele estava contratado continuam disponíveis (histórico).
- **Sem nenhum período cadastrado**, ou sendo **CLT**, não há controle: sempre disponível.
- Não existe mais Desligar/Reativar: o intervalo sem contrato é a ausência de período.
- Na lista de Colaboradores: **"Contrato encerrado"** (todos os períodos já passaram;
  oculto por padrão, aparece com "Mostrar encerrados") e **"Fora do contrato"** (entre
  dois períodos, com período futuro; fica visível).
- O **Dashboard** conta só colaboradores com contrato vigente no mês escolhido, mais os
  que já têm lançamento nele (para não esconder histórico).
- **Validações** (backend): início obrigatório, fim não anterior ao início, períodos sem
  sobreposição. Ao salvar, o sistema **avisa** se algum mês já lançado ficou fora dos
  períodos (os lançamentos não são apagados, mas o colaborador some do select desses
  meses).

### 5.3 Líquido Total (calculado na tela)

**CLT**
```
Líquido = Pagamento Contab. + Pagamento Espécie + Vale Transporte − Empréstimo
```
O **Vale Transporte** soma e o **empréstimo** (parcela paga no mês) desconta do valor final.
Nada mais entra: remuneração, prêmio, assiduidade, horas extras e combustível (que formam o
**EVA**, mostrado só como informação), Outros e Adiantamento ficam de fora. Se Contab. e Espécie estiverem em
zero, o líquido é R$ 0,00 (ou negativo, se houver empréstimo).

**Mensalista** (o salário bruto **não** entra)
```
Líquido = Pagamento Espécie + Pagamento em conta + Prêmio + Horas Extras
          + Vale Transporte + Outros − Empréstimo
          − Adiantamento Espécie   (somente enquanto NÃO houver Pagamento Espécie/em conta)
```
O adiantamento do Mensalista só **desconta enquanto o pagamento não foi lançado**: com só o
adiantamento, o líquido fica **negativo** (ex.: −R$ 2.200); ao lançar o Pagamento Espécie ou
em conta do fim do mês — que já vem líquido do adiantamento (ex.: salário 5.500 −
adiantamento 2.200 = 3.300) — o adiantamento deixa de descontar e o líquido mostra o valor
pago (R$ 3.300). O adiantamento continua registrado e marcado na lista.

**Diarista** (o Salário Bruto — diária × dias trabalhados — **não** entra, como no Mensalista)
```
Líquido = Horas Extras + Pagamento Espécie + Pagamento em conta
          + Vale Transporte + Outros − Empréstimo − Adiantamento Espécie
```
No Diarista o adiantamento **subtrai** do líquido sempre, e ele pode ficar **negativo** (por
exemplo, quando só o adiantamento foi lançado e o pagamento ainda não entrou). O Diarista
não tem prêmio. A diária × dias aparece no **Salário Bruto** do lançamento e é só
informativa: o líquido soma o que é pago (espécie e em conta), para não duplicar.

Lançamentos antigos só passam a usar a regra nova quando abertos e salvos de novo.
O recibo e o Dashboard usam o líquido salvo.

### 5.4 Adiantamento

- **Padrão do cadastro**: ao escolher o colaborador num lançamento **novo**, o
  adiantamento do cadastro (se `temAdiantamento = Sim`) já vem preenchido. Mensalista e
  Diarista são sempre em Espécie; no CLT o `tipoAdiantamento` escolhe o campo (Espécie ou
  Contab.).
- **Alterável só no lançamento**: o usuário pode mudar o valor (inclusive zerar). Ao
  reabrir um lançamento salvo, aparece o valor **salvo**, nunca o do cadastro; mudar o
  cadastro depois não altera lançamentos existentes.
- **Efeito no líquido**: CLT — só registro; **Mensalista — subtrai até o pagamento ser
  lançado**; **Diarista — subtrai** (ver 5.3).
- **Controle na lista**: o lançamento com adiantamento ganha uma etiqueta amarela ao lado
  do nome, escrita só **"Adiantamento"** (sem o valor, que fica no formulário).
- O card **Adiantamentos** do Dashboard soma os adiantamentos registrados.

### 5.5 Diarista: diária × dias

No cadastro aparece o **Valor da Diária**; no lançamento, o bloco **Diária** (valor do
cadastro + **Dias Trabalhados**) calcula a remuneração do mês (`valorDiaria × dias`).

### 5.6 Empréstimos: parcela sugerida, pagamento parcial e baixa

- No lançamento, o bloco **"Empréstimos deste mês"** lista os empréstimos com saldo,
  sugerindo o menor entre a parcela nominal e o saldo restante; cada linha é editável.
- A diferença não paga volta como saldo nos meses seguintes. O campo "Empréstimo (total)"
  é a soma das linhas.
- Empréstimo quitado some das sugestões, mas **nunca é apagado**. No cadastro, cada um
  mostra a parcela, quanto foi pago e **"Saldo R$ X"** ou **"Quitado"**.

### 5.7 Um lançamento por colaborador/mês

Ao escolher colaborador + mês: se já existe **finalizado**, bloqueia e orienta reabrir;
se **aberto**, carrega para edição. Essa validação existe só na tela, não na API.

### 5.8 Férias, CPF único e exclusão

- "Férias" zera os valores e desabilita a edição, mas grava o lançamento (histórico e
  indicador de férias).
- CPF duplicado retorna `400`. Excluir colaborador remove lançamentos e empréstimos.

### 5.9 Exportação para planilha Excel

Existem duas planilhas (não há mais exportação CSV):

**a) Planilha de COLABORADORES** — botão **Exportar** na lista de Colaboradores
(`/api/exportar-colaboradores`, arquivo `colaboradores_DD-MM-AAAA.xlsx`). Usa os dados do
**cadastro**, no padrão da contabilidade: uma aba por empresa, colunas na ordem do modelo.
Entram todos os colaboradores, **exceto os de contrato encerrado** (todos os períodos já
terminaram). Sem empresa cadastrada, o colaborador cai na aba Gerenciadora.

| Aba | Colunas (A→H) |
|---|---|
| **Gerenciadora** | *(tipo)*, CPF, Nome completo, Salário, Bonificação, Bonus em Dinheiro, Cargo, Admissão |
| **Engenharia** | Nome, Salário, Bonus, Bonus em Dinheiro, *(tipo)*, ADMISSÃO, Inicio de contrato, CPF |

Origem: **tipo** = `CLT`, ou `CONTRATO` para Mensalista/Diarista; **Salário** = remuneração
do cadastro (no Diarista, o **valor da diária**); **Bonificação/Bonus** = prêmio;
**Bonus em Dinheiro** = em branco (não existe no cadastro); **Cargo** = função;
**Admissão** = admissão; **Inicio de contrato** = início do primeiro período de contrato (ou
a admissão, se não houver períodos), só para quem não é CLT.

**b) Planilha de PAGAMENTOS do mês** — **Lançamentos → Exportar**
(`/api/exportar-planilha?mes=YYYY-MM&tipo=todos|clt|contrato`, arquivo
`pagamentos_MM-AAAA.xlsx`, com sufixo `_clt` ou `_contrato` quando filtrada). Uma única aba
**Pagamentos** com as colunas **Nome, Empresa, Pagamento em Espécie, Pagamento em Conta**,
em ordem alfabética. **Só entra quem tem valor em pelo menos um dos dois pagamentos** no
mês; quem não tem nenhum fica de fora. O modal permite filtrar a categoria (Todos, Somente
CLT, Somente Contrato = Mensalista + Diarista). Sem nenhum pagamento no mês/categoria, o
sistema avisa e não baixa arquivo. "Pagamento em Conta" é o campo Pagamento Contab. (CLT) /
Pagamento em conta (Mensalista e Diarista). **No CLT, o Vale Transporte sai somado ao
"Pagamento em Espécie"** (dinheiro), e um CLT só com Vale Transporte também entra na planilha.

**c) Planilha do EVA do mês (somente CLT)** — no modal de **Lançamentos → Exportar**, basta
escolher a categoria **"EVA (somente CLT)"** (`/api/exportar-eva?mes=YYYY-MM`, arquivo
`eva_MM-AAAA.xlsx`).
Uma aba **EVA** com **Nome, Empresa, Prêmio, Assiduidade, Horas Extras, Combustível, EVA
(total) e Cartão Alimentação**. O EVA (total) é prêmio + assiduidade + horas extras +
combustível; o **Cartão Alimentação aparece só como informação** e não entra na soma.
Entram **todos os CLT com lançamento no mês, inclusive os zerados** (para conferir quem ainda
está sem EVA); Mensalista e Diarista ficam de fora.

**Separar por empresa:** o modal **Exportar** tem o seletor **Empresa** (*Todas*, *Engenharia
(Construtora)* ou *Gerenciadora*), que vale para a planilha de pagamentos e para a do EVA
(`&empresa=Engenharia|Gerenciadora`). Cada empresa gera um arquivo próprio, com o sufixo
`_engenharia` ou `_gerenciadora` no nome. A planilha de **colaboradores** já traz uma aba por
empresa.

### 5.10 Recibos

- Disponíveis **a qualquer momento**, com o lançamento em aberto ou finalizado (não é
  preciso fechar o mês).
- CLT: **recibo de pagamento** e **recibo de prêmio (EVA)**, no modelo do cliente: "declaro
  que recebi nesta data a quantia de R$ X referente a **assiduidade**, R$ Y referente a
  **prestação de serviços** (= horas extras), R$ Z referente a **prêmios** e R$ W referente a
  **vale combustível**…", com o total e a linha de assinatura (valores zerados também
  aparecem). O cartão alimentação não entra. No **recibo de pagamento do CLT** o valor é
  só o **Pagamento em espécie** (rótulo "Pagamento em espécie"; não inclui contab. nem vale
  transporte). Mensalista/Diarista: **recibo de pagamento** (rótulo "Valor líquido") e
  **recibo de pagamento de autônomo**; o valor é o líquido salvo no momento **em módulo**: se
  estiver negativo (adiantamento já lançado), o recibo mostra o valor positivo que foi pago.
  Se o lançamento for editado, gere o recibo de novo.
- **Recibos em lote** (botão na lista de Lançamentos): escolhe-se o **mês**, o **tipo de
  recibo** (*Pagamento*, *Prêmio/EVA — só CLT* ou *Autônomo — só Mensalista/Diarista*), o
  **contrato** e a **empresa**, e o sistema imprime todos de uma vez, em ordem alfabética, com
  duas ou três caixas por página. Uma prévia mostra quantos recibos serão gerados. Recibos com
  **valor zerado** ficam de fora, a menos que se marque "Incluir recibos com valor zerado";
  lançamentos de férias não entram. O texto de cada recibo é o mesmo dos recibos individuais.
- Ao imprimir, abre a janela de impressão do navegador; quando ela fecha (imprimindo ou
  cancelando), o modal do recibo no sistema também fecha.

### 5.11 Finalizar todos

O botão **Finalizar todos** (lista de Lançamentos) finaliza todos os lançamentos **em
aberto do mês escolhido no filtro de período**. Exige um mês selecionado, ignora a busca
por nome e pede confirmação com a quantidade. Reabrir continua sendo individual.

## 6. Páginas

### 6.1 Dashboard (`/`)

- **Filtros** numa linha (Competência, Tipo de Contrato, Empresa/CNPJ) controlando
  indicadores e gráficos; o botão "Limpar" tem a mesma altura (40 px) dos campos.
- **6 indicadores**: Colaboradores, Líquido Pago, Adiantamentos, Empréstimos, Faltas,
  Atestados.
- **7 gráficos** (Chart.js, cada um com legenda expansível): líquido por empresa,
  evolução mensal do líquido, líquido por tipo de contrato, colaboradores por tipo de
  contrato, férias por mês, faltas por mês e atestados por mês.
- A antiga tabela de "Detalhamento" foi removida: as legendas dos gráficos mostram os
  mesmos dados.

### 6.2 Colaboradores (`/colaboradores`)

- A tela abre na **listagem**; **"+ Novo Colaborador"** alterna para o formulário (com
  confirmação se já houver dados preenchidos). Um único botão **Voltar** fecha o
  formulário ou, estando na lista, volta ao Dashboard.
- Lista com busca por nome, chips de tipo (CLT/Diarista/Mensalista), "Mostrar
  encerrados" (ver 5.2) e o botão **Exportar** (planilha de colaboradores, ver 5.9).
- Formulário: Dados Pessoais, Dados Profissionais (empresa, contratação, admissão,
  **períodos de contrato**), Remuneração (com diária quando aplicável), Benefícios,
  Adiantamento, Empréstimos e Observações. Máscaras de CPF e dinheiro (R$).
- Enter não salva (só o botão). Ao salvar, o colaborador permanece em edição.

### 6.3 Lançamentos (`/lancamentos`)

- Também abre na **listagem**, com **"+ Novo Lançamento"**, confirmação ao descartar e
  um único **Voltar**.
- **Filtros da lista** (todos no mesmo estilo de campo): busca por nome, **mês** (abre no mês
  atual só na primeira abertura, **se mantém** depois de salvar/editar, e não tem botão de
  limpar — sempre há um mês), **Contrato** (Todos / CLT / Diarista / Mensalista),
  **Pagamento** (Todos / Pendente / Lançado) e **Status** (Todos / Em aberto / Finalizado),
  que se combinam. Botões **Finalizar todos** (só pelo mês do filtro) e **Exportar**.
- **Controle de pagamento do mês**: considera-se **pagamento lançado** quando o lançamento
  tem **Pagamento Espécie e/ou Pagamento Contab. (em conta)** com valor — vale para CLT,
  Mensalista e Diarista (mesmos campos). Lançamento só com adiantamento continua
  **pendente**; lançamento de férias não conta como pendente. Uma faixa acima da tabela mostra,
  para o mês e o contrato filtrados, quantos lançamentos estão sem pagamento e quantos
  colaboradores ativos (pelos períodos de contrato) **ainda não têm lançamento** no mês.
  Cada link **"ver nomes"** abre a **sua lista** — *Sem pagamento lançado* ou *Sem
  lançamento* — e **clicar num nome** abre o lançamento: em aberto vai para
  a edição, finalizado abre só para visualizar, e quem não tem lançamento abre um
  **lançamento novo** já com o colaborador e o mês escolhidos. O **Finalizar todos** avisa
  quantos dos lançamentos ainda estão sem pagamento.
- **Após salvar um lançamento novo**, a tela continua no formulário, limpo e **no mesmo
  mês**, pronta para o próximo colaborador (o filtro da lista não muda). Salvar uma
  **edição** volta para a lista.
- O select de colaboradores respeita os períodos de contrato do mês (5.2) e tem chips de
  tipo de contratação.
- Em cada linha: Editar/Visualizar, recibos, Finalizar/Reabrir e Excluir; etiqueta de
  adiantamento (5.4). Se reabrir falhar, a tela mostra o motivo do erro.
- O formulário mostra só os campos do tipo: **Adiantamento Contab.** aparece apenas para
  CLT; EVA só para CLT; bloco de Diária só para Diarista. O campo ao lado de **Pagamento
  Espécie** chama-se **Pagamento Contab.** (CLT) ou **Pagamento em conta** (Mensalista e
  Diarista) e soma no líquido nos três tipos.

## 7. Frontend — componentes reaproveitáveis

- **Máscaras** `.money` e `.cpf`, por delegação de evento (inclui campos dinâmicos).
- **Select customizado** (dropdown arredondado) e **seletor de mês em português**,
  substituindo os controles nativos; o campo nativo continua como fonte de dados.
- **Toast** e **modal de confirmação** próprios (sem `alert`/`confirm`).
- **`esc()`** para escapar texto em HTML (ver 2.3).
- **Menu lateral retrátil**, com estado salvo em `localStorage`; hambúrguer no celular.
- **Visual**: paleta SEPRES (dourado `#a89826`), cards sem sombra pesada, ícones de ação
  neutros (cor só para excluir e finalizar), título em Metropolis.

## 8. Scripts e ferramentas

- `npm run build:css` / `npm run watch:css` — compilam `static/css/input.css` (Tailwind)
  para `static/css/app.css`. **Rode após qualquer alteração de classes/estilo.**
- `criar_usuario.py` — cria/atualiza usuários e, com `--zerar`, apaga todos (ver 2.1).
- `.env.example` — modelo das variáveis de ambiente.

## 9. Pontos de atenção conhecidos

- **Duplicidade de lançamento (colaborador + mês)** só é impedida na interface; a API
  aceita duplicatas em chamada direta.
- **IDs por timestamp em ms** (`Colaborador`, `Lancamento`) podem colidir sob alta
  concorrência; `Emprestimo` mitiga com bytes aleatórios.
- **Limite de tentativas em memória**: zera quando o serviço reinicia e vale por processo
  (com mais de um worker, cada um conta separado).
- O **CSP permite scripts inline**; a proteção principal contra XSS é o escape dos dados.
- `/api/backup` exporta todos os dados (CPF, salários); exige login.
- A edição de colaborador aceita qualquer campo enviado pelo navegador (só usuário logado).
- Lançamentos antigos mantêm o líquido salvo com a regra da época até serem salvos de novo.
