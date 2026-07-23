// main.js - Sistema DP (Tailwind + máscaras)

const API_URL = window.location.origin + '/api';

// Se a sessão expirar, qualquer requisição que retornar 401 leva ao login
const _fetchOriginal = window.fetch;
window.fetch = function (...args) {
    return _fetchOriginal.apply(this, args).then(function (resp) {
        if (resp.status === 401) {
            window.location.href = '/login';
        }
        return resp;
    });
};

let colaboradores = [];
let lancamentos = [];
let colabIdToDelete = null;

// ==================== HELPERS DE MÁSCARA / MOEDA ====================

// Formata um número para o padrão brasileiro "1.234,56"
function numeroBR(n) {
    return (parseFloat(n) || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Lê um campo monetário mascarado ("R$ 1.234,56" / "1.234,56") e devolve Number
function lerMoeda(el) {
    if (!el) return 0;
    let s = (el.value || '').toString().trim();
    if (!s) return 0;
    s = s.replace(/R\$/g, '').replace(/\s/g, '');
    // remove separador de milhar (.) e troca vírgula decimal por ponto
    s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}

// Escreve um valor numérico já formatado em um campo monetário
function setMoeda(el, valor) {
    if (!el) return;
    el.value = numeroBR(valor);
}

// Máscara ao digitar em campos de dinheiro (últimos dígitos = centavos)
function mascararMoeda(el) {
    let digits = (el.value || '').replace(/\D/g, '');
    if (digits === '') { el.value = ''; return; }
    const num = parseInt(digits, 10) / 100;
    el.value = num.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Máscara de CPF: 000.000.000-00
function mascararCPF(el) {
    let v = (el.value || '').replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    el.value = v;
}

// Delegação global: qualquer campo .money ou .cpf recebe máscara automaticamente.
// Registrado na fase de CAPTURA (true) para que a máscara formate o valor ANTES
// dos recálculos (calc-field / calc-liquido) lerem o campo.
document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('money')) mascararMoeda(t);
    else if (t.classList.contains('cpf')) mascararCPF(t);
}, true);

// ==================== HELPERS DE MODAL ====================

function abrirModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    document.body.classList.add('overflow-hidden');
}

// ==================== SIDEBAR (mobile) ====================

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebarBackdrop');
    if (!sb) return;
    sb.classList.toggle('-translate-x-full');
    if (bd) bd.classList.toggle('hidden');
}

// Recolhe/expande o menu no desktop e guarda a preferência
function collapseSidebar() {
    const colapsado = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', colapsado ? '1' : '0');
    atualizarIconeColapsar();
}

function atualizarIconeColapsar() {
    const icon = document.getElementById('collapseIcon');
    if (!icon) return;
    const colapsado = document.body.classList.contains('sidebar-collapsed');
    icon.className = colapsado ? 'fas fa-angle-right text-xs' : 'fas fa-angle-left text-xs';
}

// ==================== SELECT CUSTOMIZADO (dropdown arredondado) ====================
// Substitui o menu nativo do <select> por um dropdown estilizado, mantendo o
// <select> original (oculto) como fonte de dados para não quebrar a lógica.

let csMenuAberto = null; // função que fecha o menu atualmente aberto

function inicializarSelectsCustomizados(escopo) {
    (escopo || document).querySelectorAll('select.input:not([data-cs])').forEach(configurarSelectCustomizado);
}

function configurarSelectCustomizado(select) {
    select.dataset.cs = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'cs-wrapper';
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('cs-native');

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'cs-button input';
    botao.innerHTML = '<span class="cs-label"></span><i class="fas fa-chevron-down cs-chevron"></i>';
    wrapper.appendChild(botao);

    const menu = document.createElement('div');
    menu.className = 'cs-menu hidden';
    document.body.appendChild(menu);

    function atualizarLabel() {
        const opt = select.options[select.selectedIndex];
        botao.querySelector('.cs-label').textContent = opt ? opt.textContent : '';
        botao.classList.toggle('cs-placeholder', !opt || opt.value === '');
    }

    function sincronizarDisabled() {
        botao.disabled = select.disabled;
        botao.classList.toggle('cs-disabled', select.disabled);
    }

    function construirMenu() {
        menu.innerHTML = '';
        Array.from(select.options).forEach((opt, i) => {
            const item = document.createElement('div');
            item.className = 'cs-option' + (i === select.selectedIndex ? ' cs-selected' : '');
            item.textContent = opt.textContent;
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                atualizarLabel();
                fecharMenu();
            });
            menu.appendChild(item);
        });
    }

    function posicionarMenu() {
        const r = botao.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (r.bottom + 6) + 'px';
        menu.style.left = r.left + 'px';
        menu.style.width = r.width + 'px';
    }

    function abrirMenu() {
        if (select.disabled) return;
        if (csMenuAberto) csMenuAberto();
        construirMenu();
        posicionarMenu();
        menu.classList.remove('hidden');
        botao.classList.add('cs-open');
        csMenuAberto = fecharMenu;
    }

    function fecharMenu() {
        menu.classList.add('hidden');
        botao.classList.remove('cs-open');
        if (csMenuAberto === fecharMenu) csMenuAberto = null;
    }

    botao.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) abrirMenu(); else fecharMenu();
    });

    // Sincronização com o <select> original
    select.addEventListener('change', atualizarLabel);
    const descValor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
        configurable: true,
        get() { return descValor.get.call(this); },
        set(v) { descValor.set.call(this, v); atualizarLabel(); }
    });
    new MutationObserver(function () {
        atualizarLabel();
        sincronizarDisabled();
    }).observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });

    atualizarLabel();
    sincronizarDisabled();
}

// Fecha o dropdown ao clicar fora, rolar a página ou redimensionar
document.addEventListener('click', function () { if (csMenuAberto) csMenuAberto(); });
window.addEventListener('scroll', function () { if (csMenuAberto) csMenuAberto(); }, true);
window.addEventListener('resize', function () { if (csMenuAberto) csMenuAberto(); });

// ==================== SELETOR DE MÊS EM PORTUGUÊS ====================
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_PT_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function inicializarSeletoresMes(escopo) {
    (escopo || document).querySelectorAll('input.mes-ptbr:not([data-mp])').forEach(configurarSeletorMes);
}

function configurarSeletorMes(input) {
    input.dataset.mp = '1';
    input.classList.add('cs-native');

    const wrapper = document.createElement('div');
    wrapper.className = 'cs-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'cs-button input';
    botao.innerHTML = '<span class="cs-label"></span><i class="fas fa-calendar-days cs-chevron"></i>';
    wrapper.appendChild(botao);

    const painel = document.createElement('div');
    painel.className = 'cs-menu mp-panel hidden';
    document.body.appendChild(painel);

    let anoView = new Date().getFullYear();

    function parse() {
        const v = input.value;
        if (v && /^\d{4}-\d{2}$/.test(v)) {
            const [a, m] = v.split('-').map(Number);
            return { ano: a, mes: m };
        }
        return null;
    }

    function atualizarLabel() {
        const p = parse();
        botao.querySelector('.cs-label').textContent = p ? `${MESES_PT[p.mes - 1]} de ${p.ano}` : 'Selecione';
        botao.classList.toggle('cs-placeholder', !p);
    }

    function construirPainel() {
        const p = parse();
        painel.innerHTML = `
            <div class="mb-2 flex items-center justify-between px-1">
                <button type="button" class="mp-nav" data-d="-1"><i class="fas fa-chevron-left"></i></button>
                <span class="text-sm font-semibold text-slate-700">${anoView}</span>
                <button type="button" class="mp-nav" data-d="1"><i class="fas fa-chevron-right"></i></button>
            </div>
            <div class="grid grid-cols-3 gap-1">
                ${MESES_PT_ABREV.map((m, i) => {
                    const sel = p && p.ano === anoView && p.mes === i + 1;
                    return `<button type="button" class="mp-mes ${sel ? 'cs-selected' : ''}" data-m="${i + 1}">${m}</button>`;
                }).join('')}
            </div>`;
        painel.querySelectorAll('.mp-nav').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            anoView += parseInt(b.dataset.d);
            construirPainel();
        }));
        painel.querySelectorAll('.mp-mes').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            const mm = String(b.dataset.m).padStart(2, '0');
            input.value = `${anoView}-${mm}`;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            atualizarLabel();
            fechar();
        }));
    }

    function posicionar() {
        const r = botao.getBoundingClientRect();
        painel.style.position = 'fixed';
        painel.style.top = (r.bottom + 6) + 'px';
        painel.style.left = r.left + 'px';
        painel.style.width = Math.max(r.width, 240) + 'px';
    }

    function abrir() {
        if (input.disabled) return;
        if (csMenuAberto) csMenuAberto();
        const p = parse();
        anoView = p ? p.ano : new Date().getFullYear();
        construirPainel();
        posicionar();
        painel.classList.remove('hidden');
        botao.classList.add('cs-open');
        csMenuAberto = fechar;
    }

    function fechar() {
        painel.classList.add('hidden');
        botao.classList.remove('cs-open');
        if (csMenuAberto === fechar) csMenuAberto = null;
    }

    botao.addEventListener('click', e => {
        e.stopPropagation();
        painel.classList.contains('hidden') ? abrir() : fechar();
    });

    // Sincroniza quando o valor é definido programaticamente
    const descValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return descValor.get.call(this); },
        set(v) { descValor.set.call(this, v); atualizarLabel(); }
    });
    input.addEventListener('change', atualizarLabel);

    atualizarLabel();
}

function fecharModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
}

// ==================== NOTIFICAÇÕES (toast) ====================

function notificar(mensagem, tipo = 'success') {
    let cont = document.getElementById('toastContainer');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'toastContainer';
        cont.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2';
        document.body.appendChild(cont);
    }
    const estilos = {
        success: { icon: 'fa-circle-check', box: 'border-emerald-200 bg-emerald-50 text-emerald-800', ic: 'text-emerald-500' },
        error:   { icon: 'fa-circle-exclamation', box: 'border-rose-200 bg-rose-50 text-rose-800', ic: 'text-rose-500' },
        info:    { icon: 'fa-circle-info', box: 'border-indigo-200 bg-indigo-50 text-indigo-800', ic: 'text-indigo-500' }
    };
    const e = estilos[tipo] || estilos.success;
    const t = document.createElement('div');
    t.className = `flex max-w-sm items-start gap-3 rounded-xl border ${e.box} px-4 py-3 text-sm shadow-lg transition-all duration-300 translate-x-4 opacity-0`;
    t.innerHTML = `<i class="fas ${e.icon} ${e.ic} mt-0.5"></i><span class="flex-1">${mensagem}</span>`;
    cont.appendChild(t);
    requestAnimationFrame(() => t.classList.remove('translate-x-4', 'opacity-0'));
    setTimeout(() => {
        t.classList.add('translate-x-4', 'opacity-0');
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

// Confirmação estilizada (substitui window.confirm). Retorna Promise<boolean>.
function confirmar(mensagem, opcoes = {}) {
    return new Promise(resolve => {
        let modal = document.getElementById('modalConfirmar');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modalConfirmar';
            modal.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="w-full max-w-md rounded-2xl bg-white shadow-xl">
                    <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
                        <span class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600"><i class="fas fa-circle-question"></i></span>
                        <h3 class="text-lg font-semibold text-slate-900" id="confTitulo">Confirmar</h3>
                    </div>
                    <div class="px-6 py-5 text-sm text-slate-600" id="confMsg"></div>
                    <div class="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
                        <button type="button" class="btn-secondary" id="confCancelar">Cancelar</button>
                        <button type="button" class="btn-primary" id="confOk">Confirmar</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        modal.querySelector('#confTitulo').textContent = opcoes.titulo || 'Confirmar';
        modal.querySelector('#confMsg').textContent = mensagem;
        const btnOk = modal.querySelector('#confOk');
        const btnCancelar = modal.querySelector('#confCancelar');
        btnOk.className = opcoes.perigo ? 'btn-danger' : 'btn-primary';
        btnOk.textContent = opcoes.confirmar || 'Confirmar';

        const fechar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
        btnOk.onclick = () => { fechar(); resolve(true); };
        btnCancelar.onclick = () => { fechar(); resolve(false); };
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    });
}

// Após um form.reset(), atualiza os rótulos dos controles customizados (selects e
// seletores de mês), pois o reset nativo não dispara o setter interceptado.
function refrescarControlesCustom(container) {
    if (!container) return;
    container.querySelectorAll('select[data-cs], input[data-mp]').forEach(el => {
        el.dispatchEvent(new Event('change', { bubbles: false }));
    });
}

// Impede que a tecla Enter dentro de um formulário salve os dados.
// O salvamento só deve ocorrer ao clicar no botão. (Enter em textarea continua normal.)
function impedirEnterSubmit(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
}

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', function () {
    atualizarIconeColapsar();
    carregarDados();
    configurarEventos();
    inicializarSelectsCustomizados();
    inicializarSeletoresMes();
});

async function carregarDados() {
    try {
        const response = await fetch(`${API_URL}/dados`);
        if (!response.ok) {
            throw new Error(`Erro do servidor: ${response.status}`);
        }
        const dados = await response.json();
        colaboradores = Array.isArray(dados.colaboradores) ? dados.colaboradores : [];
        lancamentos = Array.isArray(dados.lancamentos) ? dados.lancamentos : [];
        renderizar();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        notificar('Erro ao conectar com o servidor. Verifique se o servidor está rodando.', 'error');
    }
}

function configurarEventos() {
    // Forms
    const formColab = document.getElementById('formColaborador');
    if (formColab) {
        formColab.addEventListener('submit', salvarColaborador);
        formColab.addEventListener('keydown', impedirEnterSubmit);
        document.getElementById('btnCancelarColab').addEventListener('click', limparFormColaborador);
    }

    const formLanc = document.getElementById('formLancamento');
    if (formLanc) {
        formLanc.addEventListener('submit', salvarLancamento);
        formLanc.addEventListener('keydown', impedirEnterSubmit);
        document.getElementById('btnCancelarLanc').addEventListener('click', limparFormLancamento);

        const colaboradorField = document.getElementById('lancColaborador');
        const mesField = document.getElementById('lancMes');
        if (colaboradorField && mesField) {
            colaboradorField.addEventListener('change', atualizarBadgeContratoLancamento);
            colaboradorField.addEventListener('change', verificarLancamentoExistente);
            mesField.addEventListener('change', verificarLancamentoExistente);
        }

        const feriasField = document.getElementById('lancFerias');
        if (feriasField) {
            feriasField.addEventListener('change', function () {
                const divDados = document.getElementById('divDadosLancamento');
                const divMensagem = document.getElementById('divMensagemFerias');
                if (this.value === 'Férias') {
                    divDados.style.display = 'none';
                    divMensagem.style.display = 'block';
                } else {
                    divDados.style.display = 'block';
                    divMensagem.style.display = 'none';
                }
            });
        }

        document.querySelectorAll('.calc-field').forEach(field => {
            field.addEventListener('input', calcularTotalRecebido);
        });
        document.querySelectorAll('.calc-liquido').forEach(field => {
            field.addEventListener('input', calcularLiquidoTotal);
        });
        document.querySelectorAll('.calc-eva').forEach(field => {
            field.addEventListener('input', calcularEva);
        });

        // Busca por nome na lista de lançamentos
        const filtroNomeLanc = document.getElementById('filtroNomeLanc');
        if (filtroNomeLanc) filtroNomeLanc.addEventListener('input', renderizarLancamentos);

        // Pagamentos por empréstimo (linhas dinâmicas): soma no total ao editar
        const listaEmp = document.getElementById('emprestimosDetalheLista');
        if (listaEmp) {
            listaEmp.addEventListener('input', function (e) {
                if (e.target.classList.contains('emp-pago')) recomputarEmprestimoTotal();
            });
        }
    }

    // Filtros do dashboard (uma linha que controla gráficos, indicadores e tabelas)
    const filtroCompetencia = document.getElementById('filtroCompetencia');
    if (filtroCompetencia) {
        ['filtroCompetencia', 'filtroMes', 'filtroContrato', 'filtroEmpresa', 'filtroTipo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', aplicarFiltrosDashboard);
        });
        document.getElementById('btnLimparFiltros').addEventListener('click', limparFiltros);
    }

    // Modal exclusão
    const btnConfirmar = document.getElementById('confirmarExclusaoColab');
    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', confirmarExclusaoColaborador);
    }
}

function renderizar() {
    const pathname = window.location.pathname;
    if (pathname.includes('index') || pathname.endsWith('/')) {
        renderizarDashboard();
    } else if (pathname.includes('colaboradores')) {
        renderizarColaboradores();
        const urlParams = new URLSearchParams(window.location.search);
        const editarId = urlParams.get('editar');
        if (editarId) {
            window.history.replaceState({}, document.title, window.location.pathname);
            setTimeout(() => editarColaborador(editarId), 300);
        }
    } else if (pathname.includes('lancamentos')) {
        renderizarLancamentos();
        configurarFiltroContratoLancamento();
        atualizarSelectColaboradores();

        const filtroMesCSV = document.getElementById('filtroMesCSV');
        if (filtroMesCSV && !filtroMesCSV.value) {
            filtroMesCSV.value = new Date().toISOString().substring(0, 7);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const editarId = urlParams.get('editar');
        if (editarId) {
            window.history.replaceState({}, document.title, window.location.pathname);
            setTimeout(() => editarLancamento(editarId), 300);
        }
    }
}

// ==================== BADGES ====================

function badgeContratacao(tipo) {
    const map = {
        'CLT': 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
        'Mensalista': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
        'Diarista': 'bg-sky-50 text-sky-700 ring-sky-600/20'
    };
    const cls = map[tipo] || 'bg-slate-100 text-slate-600 ring-slate-500/20';
    return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}">${tipo || '-'}</span>`;
}

function badgeStatus(status) {
    return status === 'finalizado'
        ? '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><i class="fas fa-check-circle"></i> Finalizado</span>'
        : '<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20"><i class="fas fa-clock"></i> Em Aberto</span>';
}

function botaoAcao(onclick, cor, icone, title) {
    const cores = {
        edit: 'text-amber-600 hover:bg-amber-50',
        delete: 'text-rose-600 hover:bg-rose-50',
        finalize: 'text-emerald-600 hover:bg-emerald-50',
        view: 'text-sky-600 hover:bg-sky-50',
        recibo: 'text-indigo-600 hover:bg-indigo-50',
        reabrir: 'text-slate-500 hover:bg-slate-100'
    };
    return `<button onclick="${onclick}" title="${title}" class="inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${cores[cor]}"><i class="fas ${icone}"></i></button>`;
}

// ==================== COLABORADORES ====================

async function salvarColaborador(e) {
    e.preventDefault();

    const editId = document.getElementById('colabEditId').value;

    // Coletar empréstimos
    const emprestimos = [];
    document.querySelectorAll('.emprestimo-item').forEach(item => {
        const valor = lerMoeda(item.querySelector('.emprestimo-valor'));
        const parcelas = parseInt(item.querySelector('.emprestimo-parcelas').value) || 1;
        const inicio = item.querySelector('.emprestimo-inicio').value;
        const descricao = item.querySelector('.emprestimo-descricao').value;
        const emprestimoId = item.dataset.emprestimoId;

        if (valor > 0 && inicio) {
            emprestimos.push({
                id: emprestimoId || (Date.now() + Math.random()),
                valor: valor,
                parcelas: parcelas,
                inicio: inicio,
                descricao: descricao || 'Sem descrição'
            });
        }
    });

    const dados = {
        id: editId || '',
        nome: document.getElementById('colabNome').value,
        cpf: document.getElementById('colabCPF').value,
        endereco: document.getElementById('colabEndereco').value,
        funcao: document.getElementById('colabFuncao').value,
        empresa: document.getElementById('colabEmpresa').value,
        contratacao: document.getElementById('colabContratacao').value,
        admissao: document.getElementById('colabAdmissao')?.value || '',
        remuneracao: lerMoeda(document.getElementById('colabRemuneracao')),
        premio: lerMoeda(document.getElementById('colabPremio')),
        valorDiaria: lerMoeda(document.getElementById('colabValorDiaria')),
        total: lerMoeda(document.getElementById('colabTotal')),
        valeRefeicao: document.getElementById('colabValeRefeicao').value,
        valeTransporte: document.getElementById('colabValeTransporte').value,
        seguroVida: document.getElementById('colabSeguroVida').value,
        planoOdonto: document.getElementById('colabPlanoOdonto')?.value || 'Não',
        dependentes: parseInt(document.getElementById('colabDependentes')?.value || 0),
        temAdiantamento: document.getElementById('colabTemAdiantamento')?.value || 'Não',
        valorAdiantamento: lerMoeda(document.getElementById('colabValorAdiantamento')),
        tipoAdiantamento: document.getElementById('colabTipoAdiantamento')?.value || 'Espécie',
        emprestimos: emprestimos,
        observacoes: document.getElementById('colabObservacoes').value
    };

    try {
        const response = await fetch(`${API_URL}/colaboradores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        if (!response.ok) {
            const erro = await response.json();
            notificar(erro.erro || 'Erro ao salvar colaborador', 'error');
            return;
        }

        const salvo = await response.json();
        notificar('Colaborador salvo com sucesso!', 'success');
        await carregarDados();
        // Mantém o colaborador salvo na tela (modo edição), em vez de limpar
        if (salvo && salvo.id) {
            editarColaborador(salvo.id);
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao salvar colaborador', 'error');
    }
}

function limparFormColaborador() {
    document.getElementById('formColaborador').reset();
    document.getElementById('colabEditId').value = '';
    document.getElementById('formColabTitle').textContent = 'Cadastrar Colaborador';
    document.getElementById('emprestimosContainer').innerHTML = '';
    setMoeda(document.getElementById('colabRemuneracao'), 0);
    setMoeda(document.getElementById('colabPremio'), 0);
    setMoeda(document.getElementById('colabTotal'), 0);
    setMoeda(document.getElementById('colabValorAdiantamento'), 0);
    setMoeda(document.getElementById('colabValorDiaria'), 0);
    if (typeof contadorEmprestimos !== 'undefined') {
        contadorEmprestimos = 0;
    }
    if (typeof atualizarContratacao === 'function') atualizarContratacao();
    if (typeof toggleDiaria === 'function') toggleDiaria();
    if (typeof toggleDependentes === 'function') toggleDependentes();
    if (typeof toggleAdiantamento === 'function') toggleAdiantamento();
    refrescarControlesCustom(document.getElementById('formColaborador'));
}

function renderizarColaboradores() {
    const tbody = document.getElementById('tabelaColaboradores');
    if (!tbody) return;

    if (colaboradores.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-slate-400"><i class="fas fa-users-slash mb-2 block text-2xl"></i>Nenhum colaborador cadastrado</td></tr>`;
        return;
    }

    tbody.innerHTML = colaboradores.map(c => `
        <tr class="border-b border-slate-100 transition hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-800">${c.nome}</td>
            <td class="px-4 py-3 text-slate-600">${c.cpf}</td>
            <td class="px-4 py-3 text-slate-600">${c.funcao || '-'}</td>
            <td class="px-4 py-3">${badgeContratacao(c.contratacao)}</td>
            <td class="px-4 py-3 font-medium text-slate-800">${formatarMoeda(c.total || c.remuneracao || 0)}</td>
            <td class="px-4 py-3">
                <div class="flex items-center justify-center gap-1">
                    ${botaoAcao(`editarColaborador('${c.id}')`, 'edit', 'fa-pen', 'Editar colaborador')}
                    ${botaoAcao(`abrirModalExcluir('${c.id}')`, 'delete', 'fa-trash', 'Excluir colaborador')}
                </div>
            </td>
        </tr>
    `).join('');
}

function editarColaborador(id) {
    const c = colaboradores.find(colab => colab.id === id);
    if (!c) return;

    document.getElementById('colabEditId').value = c.id;
    document.getElementById('colabNome').value = c.nome;
    document.getElementById('colabCPF').value = c.cpf;
    document.getElementById('colabEndereco').value = c.endereco || '';
    document.getElementById('colabFuncao').value = c.funcao || '';
    if (document.getElementById('colabEmpresa')) {
        document.getElementById('colabEmpresa').value = c.empresa || 'Engenharia';
        if (typeof atualizarContratacao === 'function') atualizarContratacao();
    }
    document.getElementById('colabContratacao').value = c.contratacao;
    if (typeof toggleDiaria === 'function') toggleDiaria();
    if (document.getElementById('colabAdmissao')) {
        document.getElementById('colabAdmissao').value = c.admissao || '';
    }
    setMoeda(document.getElementById('colabRemuneracao'), c.remuneracao || 0);
    setMoeda(document.getElementById('colabPremio'), c.premio || 0);
    setMoeda(document.getElementById('colabValorDiaria'), c.valorDiaria || 0);
    setMoeda(document.getElementById('colabTotal'), c.total || 0);
    document.getElementById('colabValeRefeicao').value = c.valeRefeicao;
    document.getElementById('colabValeTransporte').value = c.valeTransporte;
    document.getElementById('colabSeguroVida').value = c.seguroVida;
    if (document.getElementById('colabPlanoOdonto')) {
        document.getElementById('colabPlanoOdonto').value = c.planoOdonto || 'Não';
    }
    if (document.getElementById('colabDependentes')) {
        document.getElementById('colabDependentes').value = c.dependentes || 0;
    }
    if (document.getElementById('colabTemAdiantamento')) {
        document.getElementById('colabTemAdiantamento').value = c.temAdiantamento || 'Não';
    }
    setMoeda(document.getElementById('colabValorAdiantamento'), c.valorAdiantamento || 0);
    if (document.getElementById('colabTipoAdiantamento')) {
        document.getElementById('colabTipoAdiantamento').value = c.tipoAdiantamento || 'Espécie';
    }
    document.getElementById('colabObservacoes').value = c.observacoes || '';

    // Reaplica visibilidade condicional
    if (typeof toggleDependentes === 'function') toggleDependentes();
    if (typeof toggleAdiantamento === 'function') toggleAdiantamento();

    // Empréstimos
    const container = document.getElementById('emprestimosContainer');
    container.innerHTML = '';
    if (c.emprestimos && c.emprestimos.length > 0) {
        c.emprestimos.forEach(emp => adicionarEmprestimo(emp));
    }

    document.getElementById('formColabTitle').textContent = 'Editar Colaborador';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abrirModalExcluir(id) {
    colabIdToDelete = id;
    abrirModal('modalExcluirColab');
}

async function confirmarExclusaoColaborador() {
    if (!colabIdToDelete) return;

    try {
        const response = await fetch(`${API_URL}/colaboradores/${colabIdToDelete}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            notificar('Colaborador excluído com sucesso!', 'success');
            fecharModal('modalExcluirColab');
            await carregarDados();
        } else {
            notificar('Erro ao excluir colaborador', 'error');
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao excluir colaborador', 'error');
    }

    colabIdToDelete = null;
}

// ==================== LANÇAMENTOS ====================

function verificarLancamentoExistente() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    const mes = document.getElementById('lancMes').value;
    const editId = document.getElementById('lancEditId').value;

    if (!colaboradorId || !mes || editId) return;

    const lancamentoExistente = lancamentos.find(l =>
        l.colaboradorId === colaboradorId && l.mes === mes
    );

    if (lancamentoExistente) {
        const colaborador = colaboradores.find(c => c.id === colaboradorId);
        const mesFormatado = formatarMesAno(mes);

        if (lancamentoExistente.status === 'finalizado') {
            notificar(`Já existe um lançamento FINALIZADO para ${colaborador.nome} em ${mesFormatado}. Reabra o lançamento na lista para editá-lo.`, 'info');
            document.getElementById('lancColaborador').value = '';
            document.getElementById('lancMes').value = '';
        } else {
            notificar(`Já existe um lançamento em aberto para ${colaborador.nome} em ${mesFormatado}. Carregando os dados para edição.`, 'info');
            editarLancamento(lancamentoExistente.id);
        }
    } else {
        preencherCamposAutomaticamente();
        calcularEmprestimosDoMes();
    }
}

// Mostra o tipo de contratação do colaborador selecionado e exibe/esconde o
// bloco de EVA (somente CLT). Chamada sempre que o colaborador do lançamento muda.
function atualizarBadgeContratoLancamento() {
    const colaboradorId = document.getElementById('lancColaborador')?.value;
    const badge = document.getElementById('lancContratoBadge');
    const divEva = document.getElementById('divEva');
    const divAdiantamentoContab = document.getElementById('divAdiantamentoContab');
    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    const ehCLT = !!colaborador && colaborador.contratacao === 'CLT';

    if (badge) {
        badge.innerHTML = colaborador
            ? `Tipo de contratação: ${badgeContratacao(colaborador.contratacao)}`
            : '';
    }
    if (divEva) divEva.style.display = ehCLT ? 'block' : 'none';

    // Mensalista e Diarista não têm adiantamento por contabilidade — é sempre em Espécie.
    if (divAdiantamentoContab) {
        divAdiantamentoContab.style.display = ehCLT ? 'block' : 'none';
        if (!ehCLT) {
            setMoeda(document.getElementById('lancAdiantamentoContab'), 0);
        }
    }
}

function preencherCamposAutomaticamente() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    if (!colaboradorId) return;

    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    if (!colaborador) return;

    atualizarBadgeContratoLancamento();

    // Diarista: mostra o bloco de diária e calcula a remuneração por dias trabalhados
    const ehDiarista = colaborador.contratacao === 'Diarista';
    const divDiaria = document.getElementById('divDiaria');
    if (divDiaria) divDiaria.style.display = ehDiarista ? 'block' : 'none';

    if (ehDiarista) {
        setMoeda(document.getElementById('lancValorDiaria'), colaborador.valorDiaria || 0);
        document.getElementById('lancDiasTrabalhados').value = 0;
        calcularRemuneracaoDiaria(); // remuneração = diária × dias (0 no início)
    } else {
        setMoeda(document.getElementById('lancRemuneracao'), colaborador.remuneracao || 0);
    }
    setMoeda(document.getElementById('lancBonificacao'), colaborador.premio || 0);

    // Adiantamentos — zera os dois campos antes de aplicar o novo valor, para não
    // carregar sobras do colaborador selecionado anteriormente no mesmo formulário.
    setMoeda(document.getElementById('lancAdiantamentoEspecie'), 0);
    setMoeda(document.getElementById('lancAdiantamentoContab'), 0);
    if (colaborador.temAdiantamento === 'Sim' && colaborador.valorAdiantamento > 0) {
        if (colaborador.contratacao === 'CLT') {
            if (colaborador.tipoAdiantamento === 'Espécie') {
                setMoeda(document.getElementById('lancAdiantamentoEspecie'), colaborador.valorAdiantamento);
            } else {
                setMoeda(document.getElementById('lancAdiantamentoContab'), colaborador.valorAdiantamento);
            }
        } else {
            setMoeda(document.getElementById('lancAdiantamentoEspecie'), colaborador.valorAdiantamento);
        }
    }

    const totalPagamento = (colaborador.remuneracao || 0) + (colaborador.premio || 0);
    setMoeda(document.getElementById('lancPagamentoEspecie'), totalPagamento);

    // Zera os demais campos do mês para não carregar sobras do colaborador anterior
    setMoeda(document.getElementById('lancAssiduidade'), 0);
    setMoeda(document.getElementById('lancCartaoAlimentacao'), 0);
    setMoeda(document.getElementById('lancHorasExtras'), 0);
    setMoeda(document.getElementById('lancValeTransporte'), 0);
    setMoeda(document.getElementById('lancOutros'), 0);
    setMoeda(document.getElementById('lancPagamentoContab'), 0);

    calcularTotalRecebido();
}

// Soma quanto já foi pago de um empréstimo em todos os lançamentos.
// `exceptMes` (YYYY-MM) permite ignorar o mês que está sendo editado.
function calcularPagoEmprestimo(empId, exceptMes) {
    let pago = 0;
    (lancamentos || []).forEach(l => {
        if (exceptMes && l.mes === exceptMes) return;
        (l.emprestimosPagos || []).forEach(p => {
            if (String(p.id) === String(empId)) pago += (parseFloat(p.valor) || 0);
        });
    });
    return pago;
}

// Monta as linhas editáveis de empréstimo do mês. `rows` = [{id, descricao, parcela, restante, pago}]
function renderizarEmprestimosLanc(rows, readonly) {
    const container = document.getElementById('emprestimosDetalhe');
    const lista = document.getElementById('emprestimosDetalheLista');
    if (!container || !lista) return;

    if (!rows || rows.length === 0) {
        lista.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    lista.innerHTML = rows.map(r => `
        <div class="emp-row flex items-center justify-between gap-3" data-emp-id="${r.id}">
            <div class="min-w-0 flex-1 text-sm">
                <span class="font-medium text-slate-700">${r.descricao || 'Empréstimo'}</span>
                <span class="block text-xs text-slate-400">Parcela ${formatarMoeda(r.parcela)}${r.restante != null ? ' · saldo ' + formatarMoeda(r.restante) : ''}</span>
            </div>
            <div class="relative w-36 shrink-0">
                <span class="money-prefix">R$</span>
                <input type="text" inputmode="decimal" class="input money emp-pago pl-9" value="${numeroBR(r.pago)}" ${readonly ? 'disabled' : ''}>
            </div>
        </div>`).join('');

    container.style.display = 'block';
    recomputarEmprestimoTotal();
}

// Soma os valores pagos por empréstimo → total do campo Empréstimo → recalcula o líquido
function recomputarEmprestimoTotal() {
    const inputs = document.querySelectorAll('#emprestimosDetalheLista .emp-pago');
    if (inputs.length === 0) return;
    let total = 0;
    inputs.forEach(i => total += lerMoeda(i));
    setMoeda(document.getElementById('lancEmprestimo'), total);
    calcularLiquidoTotal();
}

function calcularEmprestimosDoMes() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    const mes = document.getElementById('lancMes').value;

    if (!colaboradorId || !mes) return;

    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    document.getElementById('detalhesEmprestimo').innerHTML = '';

    if (!colaborador || !colaborador.emprestimos || colaborador.emprestimos.length === 0) {
        setMoeda(document.getElementById('lancEmprestimo'), 0);
        renderizarEmprestimosLanc([]);
        return;
    }

    const [anoLanc, mesLanc] = mes.split('-').map(Number);
    const dataLancamento = new Date(anoLanc, mesLanc - 1, 1);

    const rows = [];
    colaborador.emprestimos.forEach(emp => {
        if (!/^\d{4}-\d{2}$/.test(emp.inicio || '')) return;
        const [anoInicio, mesInicio] = emp.inicio.split('-').map(Number);
        const dataInicio = new Date(anoInicio, mesInicio - 1, 1);
        if (dataLancamento < dataInicio) return; // ainda não começou

        // Quanto já foi pago em outros meses; só entra se ainda houver saldo
        const pagoAntes = calcularPagoEmprestimo(emp.id, mes);
        const restante = emp.valor - pagoAntes;
        if (restante <= 0.001) return; // já quitado

        const parcela = emp.valor / emp.parcelas;
        const sugerido = Math.min(parcela, restante);
        rows.push({
            id: emp.id,
            descricao: emp.descricao,
            parcela: parcela,
            restante: restante,
            pago: sugerido
        });
    });

    renderizarEmprestimosLanc(rows, false);
    if (rows.length === 0) setMoeda(document.getElementById('lancEmprestimo'), 0);
    calcularLiquidoTotal();
}

// Coleta os valores pagos por empréstimo das linhas do detalhamento
function coletarEmprestimosPagos() {
    return Array.from(document.querySelectorAll('#emprestimosDetalheLista .emp-row')).map(row => ({
        id: row.dataset.empId,
        valor: lerMoeda(row.querySelector('.emp-pago'))
    }));
}

async function salvarLancamento(e) {
    e.preventDefault();

    const editId = document.getElementById('lancEditId').value;
    const ferias = document.getElementById('lancFerias').value;

    let dados;
    if (ferias === 'Férias') {
        dados = {
            id: editId || '',
            colaboradorId: document.getElementById('lancColaborador').value,
            mes: document.getElementById('lancMes').value,
            ferias: 'Férias',
            diasFerias: parseInt(document.getElementById('lancDiasFerias').value) || 30,
            diasTrabalhados: 0,
            remuneracao: 0, bonificacao: 0, totalRecebido: 0,
            assiduidade: 0, cartaoAlimentacao: 0,
            adiantamentoEspecie: 0, adiantamentoContab: 0, horasExtras: 0,
            valeTransporte: 0, emprestimo: 0, outros: 0, liquidoTotal: 0,
            pagamentoContab: 0, pagamentoEspecie: 0,
            formaPagamento: document.getElementById('lancFormaPagamento').value,
            emprestimosPagos: [],
            faltas: [],
            atestados: [],
            status: editId ? (lancamentos.find(l => l.id === editId)?.status || 'aberto') : 'aberto'
        };
    } else {
        dados = {
            id: editId || '',
            colaboradorId: document.getElementById('lancColaborador').value,
            mes: document.getElementById('lancMes').value,
            ferias: ferias,
            diasFerias: 0,
            diasTrabalhados: parseInt(document.getElementById('lancDiasTrabalhados').value) || 0,
            remuneracao: lerMoeda(document.getElementById('lancRemuneracao')),
            bonificacao: lerMoeda(document.getElementById('lancBonificacao')),
            totalRecebido: lerMoeda(document.getElementById('lancTotalRecebido')),
            assiduidade: lerMoeda(document.getElementById('lancAssiduidade')),
            cartaoAlimentacao: lerMoeda(document.getElementById('lancCartaoAlimentacao')),
            adiantamentoEspecie: lerMoeda(document.getElementById('lancAdiantamentoEspecie')),
            adiantamentoContab: lerMoeda(document.getElementById('lancAdiantamentoContab')),
            horasExtras: lerMoeda(document.getElementById('lancHorasExtras')),
            valeTransporte: lerMoeda(document.getElementById('lancValeTransporte')),
            emprestimo: lerMoeda(document.getElementById('lancEmprestimo')),
            outros: lerMoeda(document.getElementById('lancOutros')),
            liquidoTotal: lerMoeda(document.getElementById('lancLiquidoTotal')),
            pagamentoContab: lerMoeda(document.getElementById('lancPagamentoContab')),
            pagamentoEspecie: lerMoeda(document.getElementById('lancPagamentoEspecie')),
            formaPagamento: document.getElementById('lancFormaPagamento').value,
            emprestimosPagos: coletarEmprestimosPagos(),
            faltas: coletarFaltas(),
            atestados: coletarAtestados(),
            status: editId ? (lancamentos.find(l => l.id === editId)?.status || 'aberto') : 'aberto'
        };
    }

    try {
        const response = await fetch(`${API_URL}/lancamentos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        if (response.ok) {
            notificar(ferias === 'Férias' ? 'Lançamento de férias salvo com sucesso!' : 'Lançamento salvo com sucesso!', 'success');
            limparFormLancamento();
            await carregarDados();
        } else {
            notificar('Erro ao salvar lançamento', 'error');
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao salvar lançamento', 'error');
    }
}

function limparFormLancamento() {
    document.getElementById('formLancamento').reset();
    document.getElementById('lancEditId').value = '';
    document.getElementById('formLancTitle').textContent = 'Novo Lançamento';
    document.getElementById('divDadosLancamento').style.display = 'block';
    document.getElementById('divMensagemFerias').style.display = 'none';

    ['lancColaborador','lancMes','lancFerias','lancFormaPagamento','lancDiasTrabalhados','lancRemuneracao','lancBonificacao',
     'lancAssiduidade','lancCartaoAlimentacao',
     'lancAdiantamentoEspecie','lancAdiantamentoContab','lancHorasExtras','lancValeTransporte',
     'lancEmprestimo','lancOutros','lancPagamentoContab','lancPagamentoEspecie'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
    });

    // Zera campos de dinheiro
    ['lancRemuneracao','lancBonificacao','lancTotalRecebido','lancEvaPremio','lancAssiduidade','lancCartaoAlimentacao',
     'lancEva','lancAdiantamentoEspecie','lancAdiantamentoContab','lancHorasExtras','lancValeTransporte',
     'lancEmprestimo','lancOutros','lancLiquidoTotal','lancPagamentoContab','lancPagamentoEspecie'].forEach(id => {
        setMoeda(document.getElementById(id), 0);
    });
    document.getElementById('detalhesEmprestimo').innerHTML = '';
    renderizarEmprestimosLanc([]);
    document.getElementById('divEva').style.display = 'none';
    document.getElementById('lancContratoBadge').innerHTML = '';

    // Limpa Faltas e Atestados
    document.getElementById('faltasContainer').innerHTML = '';
    document.getElementById('atestadosContainer').innerHTML = '';
    if (typeof contadorFaltas !== 'undefined') contadorFaltas = 0;
    if (typeof contadorAtestados !== 'undefined') contadorAtestados = 0;

    // Reseta e esconde o bloco de diária
    document.getElementById('divDiaria').style.display = 'none';
    document.getElementById('lancDiasTrabalhados').value = 0;
    setMoeda(document.getElementById('lancValorDiaria'), 0);
    document.getElementById('lancDiasFerias').value = 30;
    refrescarControlesCustom(document.getElementById('formLancamento'));

    const btnSalvar = document.querySelector('#formLancamento button[type="submit"]');
    if (btnSalvar) btnSalvar.style.display = '';

    const btnCancelar = document.getElementById('btnCancelarLanc');
    if (btnCancelar) btnCancelar.innerHTML = '<i class="fas fa-times"></i> Cancelar';
}

// Para diaristas: remuneração = valor da diária × dias trabalhados
function calcularRemuneracaoDiaria() {
    const diaria = lerMoeda(document.getElementById('lancValorDiaria'));
    const dias = parseInt(document.getElementById('lancDiasTrabalhados').value) || 0;
    setMoeda(document.getElementById('lancRemuneracao'), diaria * dias);
    calcularTotalRecebido();
}

function calcularTotalRecebido() {
    const salario = lerMoeda(document.getElementById('lancRemuneracao'));
    const premio = lerMoeda(document.getElementById('lancBonificacao'));
    setMoeda(document.getElementById('lancTotalRecebido'), salario + premio);
    calcularLiquidoTotal();
}

// Colaborador CLT selecionado no lançamento atual (usado para decidir se Horas
// Extras entra no líquido ou fica só no EVA)
function colaboradorLancamentoEhCLT() {
    const colaboradorId = document.getElementById('lancColaborador')?.value;
    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    return !!colaborador && colaborador.contratacao === 'CLT';
}

// EVA (apenas CLT): Prêmio + Assiduidade + Horas Extras — Cartão Alimentação NÃO entra.
function calcularEva() {
    const premio = lerMoeda(document.getElementById('lancBonificacao'));
    const assiduidade = lerMoeda(document.getElementById('lancAssiduidade'));
    const horasExtras = lerMoeda(document.getElementById('lancHorasExtras'));
    setMoeda(document.getElementById('lancEvaPremio'), premio);
    setMoeda(document.getElementById('lancEva'), premio + assiduidade + horasExtras);
}

function calcularLiquidoTotal() {
    const totalRecebido = lerMoeda(document.getElementById('lancTotalRecebido'));
    const horasExtras = lerMoeda(document.getElementById('lancHorasExtras'));
    const valeTransporte = lerMoeda(document.getElementById('lancValeTransporte'));
    const emprestimo = lerMoeda(document.getElementById('lancEmprestimo'));
    const outros = lerMoeda(document.getElementById('lancOutros'));
    const adiantamentoEspecie = lerMoeda(document.getElementById('lancAdiantamentoEspecie'));
    const adiantamentoContab = lerMoeda(document.getElementById('lancAdiantamentoContab'));
    const pagamentoContab = lerMoeda(document.getElementById('lancPagamentoContab'));
    const pagamentoEspecie = lerMoeda(document.getElementById('lancPagamentoEspecie'));

    // CLT: Horas Extras só compõe o EVA, não entra separadamente no líquido.
    const horasExtrasNoLiquido = colaboradorLancamentoEhCLT() ? 0 : horasExtras;

    // Líquido = Total Recebido + Horas Extras (exceto CLT) + Pagamento Contab. + Pagamento Espécie
    //           - Vale Transporte - Empréstimo - Outros - Adiantamentos (espécie + contabilidade)
    const liquido = totalRecebido + horasExtrasNoLiquido + pagamentoContab + pagamentoEspecie
                    - valeTransporte - emprestimo - outros
                    - adiantamentoEspecie - adiantamentoContab;
    setMoeda(document.getElementById('lancLiquidoTotal'), liquido);
    calcularEva();
}

function renderizarLancamentos() {
    const tbody = document.getElementById('tabelaLancamentos');
    if (!tbody) return;

    if (lancamentos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-slate-400"><i class="fas fa-file-invoice mb-2 block text-2xl"></i>Nenhum lançamento registrado</td></tr>`;
        return;
    }

    // Busca por nome do colaborador
    const termo = (document.getElementById('filtroNomeLanc')?.value || '').trim().toLowerCase();
    const lista = termo
        ? lancamentos.filter(l => {
            const c = colaboradores.find(co => co.id === l.colaboradorId);
            return c && c.nome.toLowerCase().includes(termo);
        })
        : lancamentos;

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-slate-400"><i class="fas fa-magnifying-glass mb-2 block text-2xl"></i>Nenhum lançamento encontrado para "${termo}"</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(l => {
        const c = colaboradores.find(co => co.id === l.colaboradorId);
        const acoes = l.status === 'aberto'
            ? botaoAcao(`editarLancamento('${l.id}')`, 'edit', 'fa-pen', 'Editar lançamento') +
              botaoAcao(`finalizarLancamento('${l.id}')`, 'finalize', 'fa-check', 'Finalizar lançamento') +
              botaoAcao(`excluirLancamento('${l.id}')`, 'delete', 'fa-trash', 'Excluir lançamento')
            : botaoAcao(`visualizarLancamento('${l.id}')`, 'view', 'fa-eye', 'Visualizar (somente leitura)') +
              botaoAcao(`gerarRecibo('${l.id}')`, 'recibo', 'fa-file-lines', 'Gerar recibo de pagamento') +
              botaoAcao(`reabrirLancamento('${l.id}')`, 'reabrir', 'fa-rotate-left', 'Reabrir para edição');

        return `
        <tr class="border-b border-slate-100 transition hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-800">${c ? c.nome : 'Desconhecido'}</td>
            <td class="px-4 py-3 text-slate-600">${formatarMesAno(l.mes)}</td>
            <td class="px-4 py-3 font-medium text-slate-800">${formatarMoeda(l.liquidoTotal || 0)}</td>
            <td class="px-4 py-3">${badgeStatus(l.status)}</td>
            <td class="px-4 py-3"><div class="flex items-center justify-center gap-1">${acoes}</div></td>
        </tr>`;
    }).join('');
}

function editarLancamento(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;

    document.getElementById('lancEditId').value = l.id;
    document.getElementById('lancColaborador').value = l.colaboradorId;
    document.getElementById('lancMes').value = l.mes;
    document.getElementById('lancFerias').value = l.ferias;
    document.getElementById('lancFormaPagamento').value = l.formaPagamento || 'Depósito';

    // Badge de tipo de contrato + bloco EVA (somente CLT)
    const colabDoLanc = colaboradores.find(c => c.id === l.colaboradorId);
    atualizarBadgeContratoLancamento();

    // Bloco de diária conforme o tipo do colaborador do lançamento
    const ehDiaristaEdit = colabDoLanc && colabDoLanc.contratacao === 'Diarista';
    const divDiariaEdit = document.getElementById('divDiaria');
    if (divDiariaEdit) divDiariaEdit.style.display = ehDiaristaEdit ? 'block' : 'none';
    if (ehDiaristaEdit) setMoeda(document.getElementById('lancValorDiaria'), colabDoLanc.valorDiaria || 0);
    document.getElementById('lancDiasTrabalhados').value = l.diasTrabalhados || 0;
    document.getElementById('lancDiasFerias').value = l.diasFerias || 30;

    setMoeda(document.getElementById('lancRemuneracao'), l.remuneracao || 0);
    setMoeda(document.getElementById('lancBonificacao'), l.bonificacao || 0);
    setMoeda(document.getElementById('lancTotalRecebido'), l.totalRecebido || 0);
    setMoeda(document.getElementById('lancAssiduidade'), l.assiduidade || 0);
    setMoeda(document.getElementById('lancCartaoAlimentacao'), l.cartaoAlimentacao || 0);
    setMoeda(document.getElementById('lancAdiantamentoEspecie'), l.adiantamentoEspecie || 0);
    setMoeda(document.getElementById('lancAdiantamentoContab'), l.adiantamentoContab || 0);
    setMoeda(document.getElementById('lancHorasExtras'), l.horasExtras || 0);
    setMoeda(document.getElementById('lancValeTransporte'), l.valeTransporte || 0);
    setMoeda(document.getElementById('lancEmprestimo'), l.emprestimo || 0);
    setMoeda(document.getElementById('lancOutros'), l.outros || 0);
    setMoeda(document.getElementById('lancLiquidoTotal'), l.liquidoTotal || 0);
    setMoeda(document.getElementById('lancPagamentoContab'), l.pagamentoContab || 0);
    setMoeda(document.getElementById('lancPagamentoEspecie'), l.pagamentoEspecie || 0);
    calcularEva();

    // Reconstrói o detalhamento de empréstimos a partir do que foi salvo
    const loansDoColab = (colabDoLanc && colabDoLanc.emprestimos) || [];
    const rowsEdit = (l.emprestimosPagos || []).map(p => {
        const emp = loansDoColab.find(e => String(e.id) === String(p.id));
        return {
            id: p.id,
            descricao: emp ? emp.descricao : 'Empréstimo',
            parcela: emp ? (emp.valor / emp.parcelas) : (parseFloat(p.valor) || 0),
            restante: null,
            pago: parseFloat(p.valor) || 0
        };
    });
    renderizarEmprestimosLanc(rowsEdit, false);
    if (rowsEdit.length === 0) setMoeda(document.getElementById('lancEmprestimo'), l.emprestimo || 0);

    // Reconstrói as linhas de Faltas e Atestados salvas
    document.getElementById('faltasContainer').innerHTML = '';
    contadorFaltas = 0;
    (l.faltas || []).forEach(f => adicionarFalta(f));

    document.getElementById('atestadosContainer').innerHTML = '';
    contadorAtestados = 0;
    (l.atestados || []).forEach(a => adicionarAtestado(a));

    if (l.ferias === 'Férias') {
        document.getElementById('divDadosLancamento').style.display = 'none';
        document.getElementById('divMensagemFerias').style.display = 'block';
    } else {
        document.getElementById('divDadosLancamento').style.display = 'block';
        document.getElementById('divMensagemFerias').style.display = 'none';
    }

    document.getElementById('formLancTitle').textContent = 'Editar Lançamento';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function visualizarLancamento(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;

    editarLancamento(id);

    ['lancColaborador','lancMes','lancFerias','lancFormaPagamento','lancDiasTrabalhados','lancRemuneracao','lancBonificacao',
     'lancAssiduidade','lancCartaoAlimentacao',
     'lancAdiantamentoEspecie','lancAdiantamentoContab','lancHorasExtras','lancValeTransporte',
     'lancEmprestimo','lancOutros','lancPagamentoContab','lancPagamentoEspecie'].forEach(idc => {
        const el = document.getElementById(idc);
        if (el) el.disabled = true;
    });
    document.querySelectorAll('#emprestimosDetalheLista .emp-pago').forEach(i => i.disabled = true);
    document.querySelectorAll('#faltasContainer input, #atestadosContainer input').forEach(i => i.disabled = true);
    document.querySelectorAll('#faltasContainer button, #atestadosContainer button').forEach(b => b.disabled = true);

    const btnSalvar = document.querySelector('#formLancamento button[type="submit"]');
    if (btnSalvar) btnSalvar.style.display = 'none';

    const btnCancelar = document.getElementById('btnCancelarLanc');
    if (btnCancelar) btnCancelar.innerHTML = '<i class="fas fa-times"></i> Fechar';

    document.getElementById('formLancTitle').textContent = 'Visualizar Lançamento (Somente Leitura)';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function editarLancamentoDash(id) {
    window.location.href = `/lancamentos?editar=${id}`;
}

function editarColaboradorDash(id) {
    window.location.href = `/colaboradores?editar=${id}`;
}

async function finalizarLancamento(id) {
    if (!await confirmar('Finalizar este lançamento?', { titulo: 'Finalizar lançamento' })) return;
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}/finalizar`, { method: 'PUT' });
        if (response.ok) {
            notificar('Lançamento finalizado!', 'success');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao finalizar lançamento', 'error');
    }
}

async function reabrirLancamento(id) {
    if (!await confirmar('Reabrir este lançamento para edição?', { titulo: 'Reabrir lançamento' })) return;
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}/reabrir`, { method: 'PUT' });
        if (response.ok) {
            notificar('Lançamento reaberto!', 'success');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao reabrir lançamento', 'error');
    }
}

async function excluirLancamento(id) {
    if (!await confirmar('Excluir este lançamento? Esta ação não pode ser desfeita.', { titulo: 'Excluir lançamento', perigo: true, confirmar: 'Excluir' })) return;
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}`, { method: 'DELETE' });
        if (response.ok) {
            notificar('Lançamento excluído!', 'success');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        notificar('Erro ao excluir lançamento', 'error');
    }
}

// Tipos de contratação ativos no filtro do select de Colaborador (padrão: todos)
let filtroContratoLancamento = new Set(['CLT', 'Diarista', 'Mensalista']);

function configurarFiltroContratoLancamento() {
    const container = document.getElementById('lancFiltroContratoChips');
    if (!container) return;

    container.querySelectorAll('.filtro-chip').forEach(chip => {
        chip.classList.toggle('ativo', filtroContratoLancamento.has(chip.dataset.tipo));
        chip.addEventListener('click', function () {
            const tipo = this.dataset.tipo;
            if (filtroContratoLancamento.has(tipo)) {
                filtroContratoLancamento.delete(tipo);
            } else {
                filtroContratoLancamento.add(tipo);
            }
            this.classList.toggle('ativo', filtroContratoLancamento.has(tipo));

            const select = document.getElementById('lancColaborador');
            const selecionadoAntes = select.value;
            atualizarSelectColaboradores();

            // Se o colaborador selecionado saiu do filtro, limpa a seleção e os campos dependentes
            const aindaDisponivel = Array.from(select.options).some(o => o.value === selecionadoAntes);
            if (selecionadoAntes && !aindaDisponivel) {
                select.value = '';
                atualizarBadgeContratoLancamento();
            } else {
                select.value = selecionadoAntes;
            }
            refrescarControlesCustom(document.getElementById('formLancamento'));
        });
    });
}

function atualizarSelectColaboradores() {
    const select = document.getElementById('lancColaborador');
    if (!select) return;
    const valorAtual = select.value;
    const lista = colaboradores.filter(c => filtroContratoLancamento.has(c.contratacao));
    const options = lista.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    select.innerHTML = '<option value="">Selecione</option>' + options;
    if (lista.some(c => c.id === valorAtual)) select.value = valorAtual;
}

function gerarRecibo(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;
    const c = colaboradores.find(co => co.id === l.colaboradorId);
    if (!c) return;

    document.getElementById('reciboNome').textContent = c.nome;
    document.getElementById('reciboCPF').textContent = c.cpf;
    document.getElementById('reciboValor').textContent = numeroBR(l.liquidoTotal || 0);
    document.getElementById('reciboData').textContent = new Date().toLocaleDateString('pt-BR');
    document.getElementById('reciboMes').textContent = formatarMesAno(l.mes);

    abrirModal('modalRecibo');
}

function imprimirRecibo() {
    const conteudo = document.getElementById('reciboConteudo').innerHTML;
    const janela = window.open('', '', 'width=800,height=600');
    janela.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recibo</title>
            <style>
                body { font-family: 'Courier New', monospace; padding: 20px; }
                .text-center { text-align: center; }
                p { margin: 10px 0; }
                hr { border: 1px solid #000; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div style="border: 2px solid #000; padding: 30px; max-width: 700px; margin: 0 auto;">
                ${conteudo}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    window.onafterprint = function() { window.close(); }
                }
            <\/script>
        </body>
        </html>
    `);
    janela.document.close();
}

// ==================== DASHBOARD ====================

function renderizarDashboard() {
    aplicarFiltrosDashboard();
}

// Competência selecionada: 'todos' ou 'YYYY-MM'
function getCompetencia() {
    const tipo = document.getElementById('filtroCompetencia').value;
    if (tipo !== 'mes') return 'todos';
    return document.getElementById('filtroMes').value || 'todos';
}

// Recorte único que alimenta indicadores, gráficos e tabelas
function fatiaDashboard() {
    const contrato = document.getElementById('filtroContrato').value;
    const empresa = document.getElementById('filtroEmpresa').value;
    const comp = getCompetencia();

    const colabs = colaboradores.filter(c =>
        (!contrato || c.contratacao === contrato) &&
        (!empresa || c.empresa === empresa));

    const ids = new Set(colabs.map(c => c.id));
    const lancsTodosMeses = lancamentos.filter(l => ids.has(l.colaboradorId));
    const lancs = comp === 'todos' ? lancsTodosMeses : lancsTodosMeses.filter(l => l.mes === comp);

    return { colabs, lancs, lancsTodosMeses, comp };
}

// Achata as faltas/atestados de uma lista de lançamentos em registros individuais,
// já com o colaborador e o mês do lançamento anexados (para tabelas e gráficos).
function achatarFaltas(lancs) {
    const registros = [];
    lancs.forEach(l => {
        (l.faltas || []).forEach(f => registros.push({ colaboradorId: l.colaboradorId, mes: l.mes, data: f.data, obs: f.obs }));
    });
    return registros;
}

function achatarAtestados(lancs) {
    const registros = [];
    lancs.forEach(l => {
        (l.atestados || []).forEach(a => registros.push({ colaboradorId: l.colaboradorId, mes: l.mes, data: a.data, dias: a.dias, obs: a.obs }));
    });
    return registros;
}

function aplicarFiltrosDashboard() {
    // O seletor de mês só aparece quando a competência é específica
    const competenciaEspecifica = document.getElementById('filtroCompetencia').value === 'mes';
    document.getElementById('divFiltroMes').style.display = competenciaEspecifica ? 'block' : 'none';
    if (competenciaEspecifica && !document.getElementById('filtroMes').value) {
        document.getElementById('filtroMes').value = new Date().toISOString().substring(0, 7);
    }

    const fatia = fatiaDashboard();
    atualizarCardsDashboard(fatia);
    renderizarGraficos(fatia);

    const tipo = document.getElementById('filtroTipo').value;
    const containers = {
        colaboradores: document.getElementById('tabelaColaboradoresContainer'),
        lancamentos: document.getElementById('tabelaLancamentosContainer'),
        faltas: document.getElementById('tabelaFaltasContainer'),
        atestados: document.getElementById('tabelaAtestadosContainer')
    };
    Object.entries(containers).forEach(([k, el]) => { el.style.display = (k === tipo) ? 'block' : 'none'; });

    const rotulos = { colaboradores: 'Colaboradores', lancamentos: 'Lançamentos', faltas: 'Faltas', atestados: 'Atestados' };
    document.getElementById('tipoResultado').textContent = rotulos[tipo] || tipo;

    if (tipo === 'colaboradores') {
        renderizarColaboradoresDash(fatia.colabs);
        document.getElementById('countResultados').textContent = fatia.colabs.length;
    } else if (tipo === 'lancamentos') {
        renderizarLancamentosDash(fatia.lancs);
        document.getElementById('countResultados').textContent = fatia.lancs.length;
    } else if (tipo === 'faltas') {
        const registros = achatarFaltas(fatia.lancs);
        renderizarFaltasDash(registros);
        document.getElementById('countResultados').textContent = registros.length;
    } else if (tipo === 'atestados') {
        const registros = achatarAtestados(fatia.lancs);
        renderizarAtestadosDash(registros);
        document.getElementById('countResultados').textContent = registros.length;
    }
}

function atualizarCardsDashboard(fatia) {
    const { colabs, lancs } = fatia;
    const soma = fn => lancs.reduce((s, l) => s + (fn(l) || 0), 0);

    document.getElementById('valueStat1').textContent = colabs.length;
    document.getElementById('valueStat2').textContent = formatarMoeda(soma(l => l.liquidoTotal));
    document.getElementById('valueStat3').textContent =
        formatarMoeda(soma(l => (l.adiantamentoEspecie || 0) + (l.adiantamentoContab || 0)));
    document.getElementById('valueStat4').textContent = formatarMoeda(soma(l => l.emprestimo));
    document.getElementById('valueStat5').textContent = achatarFaltas(lancs).length;
    document.getElementById('valueStat6').textContent = achatarAtestados(lancs).length;
}

function renderizarFaltasDash(registros) {
    const tbody = document.getElementById('tabelaFaltasDash');
    if (!tbody) return;
    if (registros.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-slate-400">Nenhuma falta no período filtrado</td></tr>`;
        return;
    }
    const ordenados = [...registros].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    tbody.innerHTML = ordenados.map(r => {
        const c = colaboradores.find(co => co.id === r.colaboradorId);
        return `
        <tr class="border-b border-slate-100 transition hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-800">${c ? c.nome : 'Desconhecido'}</td>
            <td class="px-4 py-3 text-slate-600">${formatarMesAno(r.mes)}</td>
            <td class="px-4 py-3 text-slate-600">${formatarData(r.data)}</td>
            <td class="px-4 py-3 text-slate-600">${r.obs || '-'}</td>
        </tr>`;
    }).join('');
}

function renderizarAtestadosDash(registros) {
    const tbody = document.getElementById('tabelaAtestadosDash');
    if (!tbody) return;
    if (registros.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-slate-400">Nenhum atestado no período filtrado</td></tr>`;
        return;
    }
    const ordenados = [...registros].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    tbody.innerHTML = ordenados.map(r => {
        const c = colaboradores.find(co => co.id === r.colaboradorId);
        return `
        <tr class="border-b border-slate-100 transition hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-800">${c ? c.nome : 'Desconhecido'}</td>
            <td class="px-4 py-3 text-slate-600">${formatarMesAno(r.mes)}</td>
            <td class="px-4 py-3 text-slate-600">${formatarData(r.data)}</td>
            <td class="px-4 py-3 text-slate-600">${r.dias || 1}</td>
            <td class="px-4 py-3 text-slate-600">${r.obs || '-'}</td>
        </tr>`;
    }).join('');
}

// ==================== GRÁFICOS ====================
// Todos os gráficos são de SÉRIE ÚNICA, numa só cor (#4f46e5 — validada: dentro da
// banda de luminosidade, acima do piso de croma e com contraste >= 3:1 no branco).
// O cinza é reservado para de-ênfase (padrão "emphasis"), nunca como categoria.

const VIZ = { dados: '#4f46e5', neutro: '#94a3b8', grade: '#e2e8f0', eixo: '#64748b' };
const graficos = {};

function moedaEixo(v) {
    if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
    return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function alternarVazio(canvasId, vazio) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const msg = canvas.parentNode.querySelector('.chart-vazio');
    canvas.style.visibility = vazio ? 'hidden' : 'visible';
    if (msg) {
        msg.classList.toggle('hidden', !vazio);
        msg.classList.toggle('flex', vazio);
    }
}

function graficoBarras(canvasId, labels, valores, opcoes = {}) {
    const { horizontal = false, moeda = true, cores = null } = opcoes;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    alternarVazio(canvasId, valores.length === 0 || valores.every(v => !v));
    if (graficos[canvasId]) graficos[canvasId].destroy();

    const eixoValor = horizontal ? 'x' : 'y';
    graficos[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: valores,
                backgroundColor: cores || VIZ.dados,
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 34
            }]
        },
        options: {
            indexAxis: horizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: ctx => moeda ? formatarMoeda(ctx.parsed[eixoValor]) : String(ctx.parsed[eixoValor])
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: horizontal,
                    border: { display: false },
                    grid: { display: horizontal, color: VIZ.grade },
                    ticks: {
                        color: VIZ.eixo, font: { size: 11 }, autoSkip: true,
                        maxRotation: 0, minRotation: 0,
                        maxTicksLimit: horizontal ? 5 : 12,
                        // contagens não têm casas decimais
                        precision: (horizontal && !moeda) ? 0 : undefined,
                        stepSize: (horizontal && !moeda) ? 1 : undefined,
                        callback: function (value) {
                            if (horizontal) return moeda ? moedaEixo(value) : value;
                            const l = this.getLabelForValue(value);
                            return String(l).length > 14 ? String(l).slice(0, 13) + '…' : l;
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { display: !horizontal, color: VIZ.grade },
                    ticks: {
                        color: VIZ.eixo, font: { size: 11 },
                        maxTicksLimit: horizontal ? 12 : 6,
                        // contagens não têm casas decimais
                        precision: (!horizontal && !moeda) ? 0 : undefined,
                        stepSize: (!horizontal && !moeda) ? 1 : undefined,
                        callback: function (value) {
                            if (!horizontal) return moeda ? moedaEixo(value) : value;
                            const l = this.getLabelForValue(value);
                            return String(l).length > 18 ? String(l).slice(0, 17) + '…' : l;
                        }
                    }
                }
            }
        }
    });
}

// Expande/recolhe o painel de detalhamento embaixo de um gráfico.
// O conteúdo é montado sempre (em renderizarGraficos), então o clique só mostra/esconde.
function toggleLegendaChart(botao) {
    const painel = document.getElementById(botao.dataset.painel);
    if (!painel) return;
    painel.classList.toggle('hidden');
    botao.classList.toggle('aberto');
}

// Preenche um painel de legenda com uma lista de linhas (nome à esquerda, valor à direita)
function montarLegendaLista(painelId, itens, montarLinha) {
    const painel = document.getElementById(painelId);
    if (!painel) return;
    if (!itens || itens.length === 0) {
        painel.innerHTML = '<div class="p-3 text-center text-xs text-slate-400">Sem dados no período filtrado</div>';
        return;
    }
    painel.innerHTML = itens.map(montarLinha).join('');
}

function renderizarGraficos(fatia) {
    if (typeof Chart === 'undefined') return;
    const { colabs, lancs, lancsTodosMeses, comp } = fatia;

    const doColab = id => colaboradores.find(c => c.id === id) || {};
    const agrupar = (arr, chave, valor) => {
        const m = {};
        arr.forEach(x => { const k = chave(x); m[k] = (m[k] || 0) + (valor(x) || 0); });
        return m;
    };

    // 1. Líquido pago por empresa (CNPJ)
    const porEmpresa = agrupar(lancs, l => doColab(l.colaboradorId).empresa || 'Não informado', l => l.liquidoTotal);
    graficoBarras('chartEmpresa', Object.keys(porEmpresa), Object.values(porEmpresa), { horizontal: true });

    // Legenda: líquido recebido por colaborador, agrupado por empresa
    const porColabEmpresa = agrupar(lancs, l => l.colaboradorId, l => l.liquidoTotal);
    const itensEmpresa = Object.entries(porColabEmpresa).map(([id, valor]) => {
        const c = doColab(id);
        return { nome: c.nome || 'Desconhecido', empresa: c.empresa || 'Não informado', valor };
    }).sort((a, b) => a.empresa.localeCompare(b.empresa) || b.valor - a.valor);
    montarLegendaLista('legendaEmpresa', itensEmpresa, i =>
        `<div class="legenda-linha"><span class="text-slate-600">${i.nome} <span class="text-slate-400">· ${i.empresa}</span></span><span class="font-medium text-slate-800">${formatarMoeda(i.valor)}</span></div>`);

    // 2. Evolução mensal — sempre todos os meses; o mês filtrado fica destacado
    const porMes = agrupar(lancsTodosMeses, l => l.mes, l => l.liquidoTotal);
    const meses = Object.keys(porMes).sort();
    const coresMes = comp === 'todos'
        ? VIZ.dados
        : meses.map(m => (m === comp ? VIZ.dados : VIZ.neutro));
    graficoBarras('chartEvolucao', meses.map(formatarMesAno), meses.map(m => porMes[m]), { cores: coresMes });

    // 3. Líquido pago por tipo de contrato
    const porContrato = agrupar(lancs, l => doColab(l.colaboradorId).contratacao || 'Não informado', l => l.liquidoTotal);
    graficoBarras('chartContrato', Object.keys(porContrato), Object.values(porContrato), {});

    // Legenda: líquido recebido por colaborador, agrupado por tipo de contrato (ex.: quanto cada CLT recebeu)
    const itensContrato = Object.entries(porColabEmpresa).map(([id, valor]) => {
        const c = doColab(id);
        return { nome: c.nome || 'Desconhecido', contratacao: c.contratacao || 'Não informado', valor };
    }).sort((a, b) => a.contratacao.localeCompare(b.contratacao) || b.valor - a.valor);
    montarLegendaLista('legendaContrato', itensContrato, i =>
        `<div class="legenda-linha"><span class="text-slate-600">${i.nome} <span class="text-slate-400">· ${i.contratacao}</span></span><span class="font-medium text-slate-800">${formatarMoeda(i.valor)}</span></div>`);

    // 4. Colaboradores por tipo de contrato (quantidade)
    const headcount = {};
    colabs.forEach(c => { const k = c.contratacao || 'Não informado'; headcount[k] = (headcount[k] || 0) + 1; });
    graficoBarras('chartHeadcount', Object.keys(headcount), Object.values(headcount), { moeda: false });

    // 5. Composição dos descontos
    const descontos = {
        'Adiantamentos': lancs.reduce((s, l) => s + (l.adiantamentoEspecie || 0) + (l.adiantamentoContab || 0), 0),
        'Empréstimos': lancs.reduce((s, l) => s + (l.emprestimo || 0), 0),
        'Vale Transporte': lancs.reduce((s, l) => s + (l.valeTransporte || 0), 0),
        'Outros': lancs.reduce((s, l) => s + (l.outros || 0), 0)
    };
    graficoBarras('chartDescontos', Object.keys(descontos), Object.values(descontos), { horizontal: true });

    // 6. Quantidade de férias por mês (mesma leitura da evolução: todos os meses,
    //    com o mês filtrado destacado)
    const feriasPorMes = {};
    lancsTodosMeses.forEach(l => {
        if (l.ferias === 'Férias') feriasPorMes[l.mes] = (feriasPorMes[l.mes] || 0) + 1;
    });
    graficoBarras('chartFerias', meses.map(formatarMesAno), meses.map(m => feriasPorMes[m] || 0),
        { moeda: false, cores: coresMes });

    // Legenda: quem teve férias no período filtrado e quantos dias
    const itensFerias = lancs.filter(l => l.ferias === 'Férias').map(l => {
        const c = doColab(l.colaboradorId);
        return { nome: c.nome || 'Desconhecido', mes: formatarMesAno(l.mes), dias: l.diasFerias || 30 };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
    montarLegendaLista('legendaFerias', itensFerias, i =>
        `<div class="legenda-linha"><span class="text-slate-600">${i.nome} <span class="text-slate-400">· ${i.mes}</span></span><span class="font-medium text-slate-800">${i.dias} dia(s)</span></div>`);

    // 7. Faltas por mês (mesmo padrão: todos os meses, mês filtrado destacado)
    const faltasPorMes = {};
    achatarFaltas(lancsTodosMeses).forEach(f => { faltasPorMes[f.mes] = (faltasPorMes[f.mes] || 0) + 1; });
    graficoBarras('chartFaltas', meses.map(formatarMesAno), meses.map(m => faltasPorMes[m] || 0),
        { moeda: false, cores: coresMes });

    // Legenda: quem teve falta no período filtrado
    const itensFaltas = achatarFaltas(lancs).map(f => {
        const c = doColab(f.colaboradorId);
        return { nome: c.nome || 'Desconhecido', data: formatarData(f.data), obs: f.obs || '-' };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
    montarLegendaLista('legendaFaltas', itensFaltas, i =>
        `<div class="legenda-linha"><span class="text-slate-600">${i.nome} <span class="text-slate-400">· ${i.data}</span></span><span class="max-w-[50%] truncate font-medium text-slate-800" title="${i.obs}">${i.obs}</span></div>`);

    // 8. Atestados por mês (contagem de atestados, não soma de dias)
    const atestadosPorMes = {};
    achatarAtestados(lancsTodosMeses).forEach(a => { atestadosPorMes[a.mes] = (atestadosPorMes[a.mes] || 0) + 1; });
    graficoBarras('chartAtestados', meses.map(formatarMesAno), meses.map(m => atestadosPorMes[m] || 0),
        { moeda: false, cores: coresMes });

    // Legenda: quem teve atestado no período filtrado e quantos dias
    const itensAtestados = achatarAtestados(lancs).map(a => {
        const c = doColab(a.colaboradorId);
        return { nome: c.nome || 'Desconhecido', data: formatarData(a.data), dias: a.dias || 1 };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
    montarLegendaLista('legendaAtestados', itensAtestados, i =>
        `<div class="legenda-linha"><span class="text-slate-600">${i.nome} <span class="text-slate-400">· ${i.data}</span></span><span class="font-medium text-slate-800">${i.dias} dia(s)</span></div>`);
}

function renderizarColaboradoresDash(lista) {
    const tbody = document.getElementById('tabelaColaboradoresDash');
    if (!tbody) return;

    if (!lista || lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-slate-400">Nenhum colaborador para os filtros</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(c => `
        <tr class="border-b border-slate-100 transition hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-800">${c.nome}</td>
            <td class="px-4 py-3 text-slate-600">${c.cpf}</td>
            <td class="px-4 py-3 text-slate-600">${c.empresa || '-'}</td>
            <td class="px-4 py-3">${badgeContratacao(c.contratacao)}</td>
            <td class="px-4 py-3 font-medium text-slate-800">${formatarMoeda(c.total || c.remuneracao || 0)}</td>
            <td class="px-4 py-3"><div class="flex justify-center">${botaoAcao(`editarColaboradorDash('${c.id}')`, 'view', 'fa-eye', 'Ver / editar colaborador')}</div></td>
        </tr>
    `).join('');
}

function renderizarLancamentosDash(lista) {
    const tbody = document.getElementById('tabelaLancamentosDash');
    if (!tbody) return;

    if (!lista || lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-slate-400">Nenhum lançamento para os filtros</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(l => {
        const c = colaboradores.find(co => co.id === l.colaboradorId);
        const btnAcao = l.status === 'finalizado'
            ? botaoAcao(`visualizarLancamento('${l.id}')`, 'view', 'fa-eye', 'Visualizar (somente leitura)')
            : botaoAcao(`editarLancamentoDash('${l.id}')`, 'edit', 'fa-pen', 'Editar lançamento');

        return `
            <tr class="border-b border-slate-100 transition hover:bg-slate-50">
                <td class="px-4 py-3 font-medium text-slate-800">${c ? c.nome : 'Desconhecido'}</td>
                <td class="px-4 py-3 text-slate-600">${formatarMesAno(l.mes)}</td>
                <td class="px-4 py-3 text-slate-600">${formatarMoeda(l.totalRecebido || 0)}</td>
                <td class="px-4 py-3 text-slate-600">${formatarMoeda((l.adiantamentoEspecie || 0) + (l.adiantamentoContab || 0))}</td>
                <td class="px-4 py-3 font-medium text-slate-800">${formatarMoeda(l.liquidoTotal || 0)}</td>
                <td class="px-4 py-3">${badgeStatus(l.status)}</td>
                <td class="px-4 py-3"><div class="flex justify-center">${btnAcao}</div></td>
            </tr>`;
    }).join('');
}

function limparFiltros() {
    document.getElementById('filtroCompetencia').value = 'todos';
    document.getElementById('filtroContrato').value = '';
    document.getElementById('filtroEmpresa').value = '';
    document.getElementById('filtroTipo').value = 'colaboradores';
    aplicarFiltrosDashboard();
}

// ==================== EXPORTAÇÃO CSV ====================

function exportarCSV() {
    const mesFiltro = document.getElementById('filtroMesCSV').value;
    if (!mesFiltro) {
        notificar('Selecione um mês para exportar.', 'info');
        return;
    }

    const lancamentosMes = lancamentos.filter(l => l.mes === mesFiltro);
    if (lancamentosMes.length === 0) {
        notificar('Não há lançamentos para o mês selecionado.', 'info');
        return;
    }

    let csv = 'Nome;Adiantamento Contabilidade;Adiantamento Espécie;Pagamento Contabilidade;Pagamento Espécie\n';
    lancamentosMes.forEach(l => {
        const colaborador = colaboradores.find(c => c.id === l.colaboradorId);
        const nome = colaborador ? colaborador.nome : 'Desconhecido';
        const adiantamentoContab = (l.adiantamentoContab || 0).toFixed(2).replace('.', ',');
        const adiantamentoEspecie = (l.adiantamentoEspecie || 0).toFixed(2).replace('.', ',');
        const pagamentoContab = (l.pagamentoContab || 0).toFixed(2).replace('.', ',');
        const pagamentoEspecie = (l.pagamentoEspecie || 0).toFixed(2).replace('.', ',');
        csv += `${nome};${adiantamentoContab};${adiantamentoEspecie};${pagamentoContab};${pagamentoEspecie}\n`;
    });

    const BOM = '﻿';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const mesFormatado = formatarMesAno(mesFiltro).replace('/', '-');
    link.setAttribute('href', url);
    link.setAttribute('download', `lancamentos_${mesFormatado}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    notificar(`CSV exportado! ${lancamentosMes.length} lançamento(s) de ${formatarMesAno(mesFiltro)}.`, 'success');
}

// ==================== UTILITÁRIOS ====================

function formatarMoeda(valor) {
    return (parseFloat(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarMesAno(mesAno) {
    if (!mesAno) return '-';
    const [ano, mes] = mesAno.split('-');
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${meses[parseInt(mes) - 1]}/${ano}`;
}

function formatarData(data) {
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return '-';
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano}`;
}
