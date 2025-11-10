// main.js - Versão com API Backend

const API_URL = window.location.origin + '/api';

let colaboradores = [];
let lancamentos = [];
let colabIdToDelete = null;

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    carregarDados();
    configurarEventos();
});

async function carregarDados() {
    try {
        // Usa a rota geral para carregar todos os dados de uma vez
        const response = await fetch(`${API_URL}/dados`); 
        
        // **IMPORTANTE:** Verificar se a resposta é OK antes de tentar ler JSON
        if (!response.ok) {
            throw new Error(`Erro do servidor: ${response.status}`);
        }
        
        const dados = await response.json();
        
        // **IMPORTANTE:** Garante que as variáveis globais sejam sempre listas,
        // mesmo se o servidor não retornar a chave (Embora o backend agora garanta isso)
        colaboradores = Array.isArray(dados.colaboradores) ? dados.colaboradores : [];
        lancamentos = Array.isArray(dados.lancamentos) ? dados.lancamentos : [];
        
        renderizar();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        // Esta é a mensagem que o usuário vê se o backend falhar (500)
        alert('Erro ao conectar com o servidor. Verifique se o servidor está rodando.');
    }
}

function configurarEventos() {
    // Máscara CPF
    const cpfInput = document.getElementById('colabCPF');
    if (cpfInput) {
        cpfInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length <= 11) {
                value = value.replace(/(\d{3})(\d)/, '$1.$2');
                value = value.replace(/(\d{3})(\d)/, '$1.$2');
                value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                e.target.value = value;
            }
        });
    }

    // Forms
    const formColab = document.getElementById('formColaborador');
    if (formColab) {
        formColab.addEventListener('submit', salvarColaborador);
        document.getElementById('btnCancelarColab').addEventListener('click', limparFormColaborador);
    }

    const formLanc = document.getElementById('formLancamento');
    if (formLanc) {
        formLanc.addEventListener('submit', salvarLancamento);
        document.getElementById('btnCancelarLanc').addEventListener('click', limparFormLancamento);
        
        // Validação de lançamento duplicado
        const colaboradorField = document.getElementById('lancColaborador');
        const mesField = document.getElementById('lancMes');
        if (colaboradorField && mesField) {
            colaboradorField.addEventListener('change', verificarLancamentoExistente);
            mesField.addEventListener('change', verificarLancamentoExistente);
        }
        
        // Listener para o campo Férias
        const feriasField = document.getElementById('lancFerias');
        if (feriasField) {
            feriasField.addEventListener('change', function() {
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
        
        const outrosField = document.getElementById('lancOutros');
        if (outrosField) {
            outrosField.addEventListener('input', calcularTotalRecebido);
        }
    }

    // Filtros
    const filtroMes = document.getElementById('filtroMes');
    if (filtroMes) {
        document.getElementById('filtroTipo').addEventListener('change', aplicarFiltrosDashboard);
        filtroMes.addEventListener('change', aplicarFiltrosDashboard);
        document.getElementById('filtroColaborador').addEventListener('change', aplicarFiltrosDashboard);
        document.getElementById('btnLimparFiltros').addEventListener('click', limparFiltros);
    }

    // Modal
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
        
        // Verifica se há parâmetro editar na URL
        const urlParams = new URLSearchParams(window.location.search);
        const editarId = urlParams.get('editar');
        if (editarId) {
            // Remove o parâmetro da URL
            window.history.replaceState({}, document.title, window.location.pathname);
            // Edita o colaborador
            setTimeout(() => editarColaborador(editarId), 500);
        }
    } else if (pathname.includes('lancamentos')) {
        renderizarLancamentos();
        atualizarSelectColaboradores();
        
        // Configurar mês atual no filtro CSV
        const filtroMesCSV = document.getElementById('filtroMesCSV');
        if (filtroMesCSV && !filtroMesCSV.value) {
            filtroMesCSV.value = new Date().toISOString().substring(0, 7);
        }
        
        // Verifica se há parâmetro editar na URL
        const urlParams = new URLSearchParams(window.location.search);
        const editarId = urlParams.get('editar');
        if (editarId) {
            // Remove o parâmetro da URL
            window.history.replaceState({}, document.title, window.location.pathname);
            // Edita o lançamento
            setTimeout(() => editarLancamento(editarId), 500);
        }
    }
}

// ==================== COLABORADORES ====================

async function salvarColaborador(e) {
    e.preventDefault();
    
    const editId = document.getElementById('colabEditId').value;
    
    // Coletar empréstimos
    const emprestimos = [];
    const emprestimosItems = document.querySelectorAll('.emprestimo-item');
    emprestimosItems.forEach(item => {
        const valor = parseFloat(item.querySelector('.emprestimo-valor').value) || 0;
        const parcelas = parseInt(item.querySelector('.emprestimo-parcelas').value) || 1;
        const inicio = item.querySelector('.emprestimo-inicio').value;
        const descricao = item.querySelector('.emprestimo-descricao').value;
        const emprestimoId = item.dataset.emprestimoId; // Preservar ID se existir
        
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
        contratacao: document.getElementById('colabContratacao').value,
        admissao: document.getElementById('colabAdmissao')?.value || '',
        remuneracao: parseFloat(document.getElementById('colabRemuneracao')?.value || 0),
        premio: parseFloat(document.getElementById('colabPremio')?.value || 0),
        total: parseFloat(document.getElementById('colabTotal')?.value || 0),
        valeRefeicao: document.getElementById('colabValeRefeicao').value,
        valeTransporte: document.getElementById('colabValeTransporte').value,
        seguroVida: document.getElementById('colabSeguroVida').value,
        planoOdonto: document.getElementById('colabPlanoOdonto')?.value || 'Não',
        dependentes: parseInt(document.getElementById('colabDependentes')?.value || 0),
        temAdiantamento: document.getElementById('colabTemAdiantamento')?.value || 'Não',
        valorAdiantamento: parseFloat(document.getElementById('colabValorAdiantamento')?.value || 0),
        tipoAdiantamento: document.getElementById('colabTipoAdiantamento')?.value || 'Espécie',
        emprestimos: emprestimos,
        observacoes: document.getElementById('colabObservacoes').value
    };

    try {
        const response = await fetch(`${API_URL}/colaboradores`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(dados)
        });

        if (!response.ok) {
            const erro = await response.json();
            alert(erro.erro || 'Erro ao salvar colaborador');
            return;
        }

        const colaboradorSalvo = await response.json();
        alert('Colaborador salvo com sucesso!');
        
        // Recarregar dados
        await carregarDados();
        
        // Sempre limpar o formulário após salvar (independente de ser novo ou edição)
        limparFormColaborador();
        
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao salvar colaborador');
    }
}

function limparFormColaborador() {
    document.getElementById('formColaborador').reset();
    document.getElementById('colabEditId').value = '';
    document.getElementById('formColabTitle').textContent = 'Cadastrar Colaborador';
    document.getElementById('emprestimosContainer').innerHTML = '';
    if (typeof contadorEmprestimos !== 'undefined') {
        contadorEmprestimos = 0;
    }
}

function renderizarColaboradores() {
    const tbody = document.getElementById('tabelaColaboradores');
    if (!tbody) return;
    
    tbody.innerHTML = colaboradores.map(c => {
        const badgeColor = c.contratacao === 'CLT' ? 'primary' : 
                          c.contratacao === 'Mensalista' ? 'success' : 'info';
        return `
        <tr>
            <td>${c.nome}</td>
            <td>${c.cpf}</td>
            <td>${c.funcao || '-'}</td>
            <td><span class="badge bg-${badgeColor}">${c.contratacao}</span></td>
            <td>${formatarMoeda(c.total || c.remuneracao || 0)}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-warning" onclick="editarColaborador('${c.id}')" title="Editar colaborador">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="abrirModalExcluir('${c.id}')" title="Excluir colaborador">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `}).join('');
}

function editarColaborador(id) {
    const c = colaboradores.find(colab => colab.id === id);
    if (!c) return;

    document.getElementById('colabEditId').value = c.id;
    document.getElementById('colabNome').value = c.nome;
    document.getElementById('colabCPF').value = c.cpf;
    document.getElementById('colabEndereco').value = c.endereco;
    document.getElementById('colabFuncao').value = c.funcao;
    document.getElementById('colabContratacao').value = c.contratacao;
    if (document.getElementById('colabAdmissao')) {
        document.getElementById('colabAdmissao').value = c.admissao || '';
    }
    if (document.getElementById('colabRemuneracao')) {
        document.getElementById('colabRemuneracao').value = c.remuneracao || 0;
    }
    if (document.getElementById('colabPremio')) {
        document.getElementById('colabPremio').value = c.premio || 0;
    }
    if (document.getElementById('colabTotal')) {
        document.getElementById('colabTotal').value = c.total || 0;
    }
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
    if (document.getElementById('colabValorAdiantamento')) {
        document.getElementById('colabValorAdiantamento').value = c.valorAdiantamento || 0;
    }
    if (document.getElementById('colabTipoAdiantamento')) {
        document.getElementById('colabTipoAdiantamento').value = c.tipoAdiantamento || 'Espécie';
    }
    document.getElementById('colabObservacoes').value = c.observacoes || '';
    
    // Empréstimos
    const container = document.getElementById('emprestimosContainer');
    container.innerHTML = '';
    if (c.emprestimos && c.emprestimos.length > 0) {
        c.emprestimos.forEach(emp => {
            adicionarEmprestimo(emp);
        });
    }

    document.getElementById('formColabTitle').textContent = 'Editar Colaborador';
    window.scrollTo(0, 0);
}

function abrirModalExcluir(id) {
    colabIdToDelete = id;
    const modal = new bootstrap.Modal(document.getElementById('modalExcluirColab'));
    modal.show();
}

async function confirmarExclusaoColaborador() {
    if (!colabIdToDelete) return;

    try {
        const response = await fetch(`${API_URL}/colaboradores/${colabIdToDelete}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('Colaborador excluído com sucesso!');
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalExcluirColab'));
            modal.hide();
            await carregarDados();
        } else {
            alert('Erro ao excluir colaborador');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao excluir colaborador');
    }
    
    colabIdToDelete = null;
}

// ==================== LANÇAMENTOS ====================

function verificarLancamentoExistente() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    const mes = document.getElementById('lancMes').value;
    const editId = document.getElementById('lancEditId').value;
    
    // Só verifica se ambos os campos estão preenchidos e não estamos editando
    if (!colaboradorId || !mes || editId) return;
    
    // Busca lançamento existente
    const lancamentoExistente = lancamentos.find(l => 
        l.colaboradorId === colaboradorId && l.mes === mes
    );
    
    if (lancamentoExistente) {
        const colaborador = colaboradores.find(c => c.id === colaboradorId);
        const mesFormatado = formatarMesAno(mes);
        
        if (lancamentoExistente.status === 'finalizado') {
            // Lançamento finalizado - bloqueia e avisa
            alert(`⚠️ Atenção!\n\nJá existe um lançamento FINALIZADO para ${colaborador.nome} no mês ${mesFormatado}.\n\nPara editar, você precisa REABRIR o lançamento primeiro na lista abaixo.`);
            
            // Limpa os campos
            document.getElementById('lancColaborador').value = '';
            document.getElementById('lancMes').value = '';
        } else {
            // Lançamento aberto - avisa e pergunta se quer editar
            alert(`⚠️ Atenção!\n\nJá existe um lançamento EM ABERTO para ${colaborador.nome} no mês ${mesFormatado}.\n\nOs dados serão carregados para edição.`);
            
            // Carrega automaticamente
            editarLancamento(lancamentoExistente.id);
        }
    } else {
        // Não existe lançamento, preencher campos automaticamente
        preencherCamposAutomaticamente();
        calcularEmprestimosDoMes();
    }
}

function preencherCamposAutomaticamente() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    if (!colaboradorId) return;
    
    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    if (!colaborador) return;
    
    // Preencher Remuneração e Prêmio
    if (colaborador.contratacao === 'Mensalista' || colaborador.contratacao === 'Diarista') {
        // Para Mensalista e Diarista: preencher valores brutos
        document.getElementById('lancRemuneracao').value = colaborador.remuneracao || 0;
        document.getElementById('lancBonificacao').value = colaborador.premio || 0;
    } else if (colaborador.contratacao === 'CLT') {
        // Para CLT: preencher valores líquidos (já descontados)
        document.getElementById('lancRemuneracao').value = colaborador.remuneracao || 0;
        document.getElementById('lancBonificacao').value = colaborador.premio || 0;
    }
    
    // Preencher Adiantamentos
    if (colaborador.temAdiantamento === 'Sim' && colaborador.valorAdiantamento > 0) {
        if (colaborador.contratacao === 'CLT') {
            // CLT: Adiantamento vai para Contabilidade
            if (colaborador.tipoAdiantamento === 'Espécie') {
                document.getElementById('lancAdiantamentoEspecie').value = colaborador.valorAdiantamento;
            } else {
                document.getElementById('lancAdiantamentoContab').value = colaborador.valorAdiantamento;
            }
        } else {
            // Mensalista/Diarista: Adiantamento vai para Espécie
            document.getElementById('lancAdiantamentoEspecie').value = colaborador.valorAdiantamento;
        }
    }
    
    // Preencher Pagamento Espécie com Total (Remuneração + Prêmio)
    const totalPagamento = (colaborador.remuneracao || 0) + (colaborador.premio || 0);
    document.getElementById('lancPagamentoEspecie').value = totalPagamento;
    
    // Recalcular totais
    calcularTotalRecebido();
}

function calcularEmprestimosDoMes() {
    const colaboradorId = document.getElementById('lancColaborador').value;
    const mes = document.getElementById('lancMes').value;
    
    if (!colaboradorId || !mes) return;
    
    const colaborador = colaboradores.find(c => c.id === colaboradorId);
    if (!colaborador || !colaborador.emprestimos || colaborador.emprestimos.length === 0) {
        document.getElementById('lancEmprestimo').value = '0';
        document.getElementById('detalhesEmprestimo').innerHTML = '';
        return;
    }
    
    // Converter mês do lançamento para Date
    const [anoLanc, mesLanc] = mes.split('-').map(Number);
    const dataLancamento = new Date(anoLanc, mesLanc - 1, 1);
    
    let totalEmprestimos = 0;
    let detalhes = [];
    
    // Para cada empréstimo do colaborador
    colaborador.emprestimos.forEach(emp => {
        // Converter data de início do empréstimo
        const [anoInicio, mesInicio] = emp.inicio.split('-').map(Number);
        const dataInicio = new Date(anoInicio, mesInicio - 1, 1);
        
        // Calcular valor da parcela
        const valorParcela = emp.valor / emp.parcelas;
        
        // Verificar se o mês do lançamento está dentro do período do empréstimo
        let mesAtual = new Date(dataInicio);
        
        for (let i = 0; i < emp.parcelas; i++) {
            if (mesAtual.getFullYear() === dataLancamento.getFullYear() && 
                mesAtual.getMonth() === dataLancamento.getMonth()) {
                // Este empréstimo tem parcela neste mês
                totalEmprestimos += valorParcela;
                const parcelaAtual = i + 1;
                detalhes.push(`${emp.descricao}: ${parcelaAtual}/${emp.parcelas} - R$ ${valorParcela.toFixed(2)}`);
                break;
            }
            // Avançar para o próximo mês
            mesAtual.setMonth(mesAtual.getMonth() + 1);
        }
    });
    
    // Preencher o campo
    document.getElementById('lancEmprestimo').value = totalEmprestimos.toFixed(2);
    
    // Mostrar detalhes
    if (detalhes.length > 0) {
        document.getElementById('detalhesEmprestimo').innerHTML = 
            '<i class="fas fa-info-circle text-info"></i> ' + detalhes.join('<br>');
    } else {
        document.getElementById('detalhesEmprestimo').innerHTML = '';
    }
    
    // Recalcular o líquido
    calcularLiquidoTotal();
}

async function salvarLancamento(e) {
    e.preventDefault();
    
    const editId = document.getElementById('lancEditId').value;
    const ferias = document.getElementById('lancFerias').value;
    
    // Se está de férias, salvar apenas dados básicos
    if (ferias === 'Férias') {
        const dados = {
            id: editId || '',
            colaboradorId: document.getElementById('lancColaborador').value,
            mes: document.getElementById('lancMes').value,
            ferias: 'Férias',
            remuneracao: 0,
            bonificacao: 0,
            totalRecebido: 0,
            adiantamentoEspecie: 0,
            adiantamentoContab: 0,
            horasExtras: 0,
            valeTransporte: 0,
            emprestimo: 0,
            outros: 0,
            liquidoTotal: 0,
            pagamentoContab: 0,
            pagamentoEspecie: 0,
            status: editId ? lancamentos.find(l => l.id === editId)?.status || 'aberto' : 'aberto'
        };
        
        try {
            const response = await fetch(`${API_URL}/lancamentos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(dados)
            });

            if (response.ok) {
                alert('Lançamento de férias salvo com sucesso!');
                limparFormLancamento();
                await carregarDados();
            } else {
                alert('Erro ao salvar lançamento');
            }
        } catch (error) {
            console.error('Erro:', error);
            alert('Erro ao salvar lançamento');
        }
        return;
    }
    
    // Se não está de férias, salvar normalmente
    const dados = {
        id: editId || '',
        colaboradorId: document.getElementById('lancColaborador').value,
        mes: document.getElementById('lancMes').value,
        ferias: ferias,
        remuneracao: parseFloat(document.getElementById('lancRemuneracao').value) || 0,
        bonificacao: parseFloat(document.getElementById('lancBonificacao').value) || 0,
        totalRecebido: parseFloat(document.getElementById('lancTotalRecebido').value) || 0,
        adiantamentoEspecie: parseFloat(document.getElementById('lancAdiantamentoEspecie').value) || 0,
        adiantamentoContab: parseFloat(document.getElementById('lancAdiantamentoContab').value) || 0,
        horasExtras: parseFloat(document.getElementById('lancHorasExtras').value) || 0,
        valeTransporte: parseFloat(document.getElementById('lancValeTransporte').value) || 0,
        emprestimo: parseFloat(document.getElementById('lancEmprestimo').value) || 0,
        outros: parseFloat(document.getElementById('lancOutros').value) || 0,
        liquidoTotal: parseFloat(document.getElementById('lancLiquidoTotal').value) || 0,
        pagamentoContab: parseFloat(document.getElementById('lancPagamentoContab').value) || 0,
        pagamentoEspecie: parseFloat(document.getElementById('lancPagamentoEspecie').value) || 0,
        status: editId ? lancamentos.find(l => l.id === editId)?.status || 'aberto' : 'aberto'
    };

    try {
        const response = await fetch(`${API_URL}/lancamentos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(dados)
        });

        if (response.ok) {
            alert('Lançamento salvo com sucesso!');
            limparFormLancamento();
            await carregarDados();
        } else {
            alert('Erro ao salvar lançamento');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao salvar lançamento');
    }
}

function limparFormLancamento() {
    document.getElementById('formLancamento').reset();
    document.getElementById('lancEditId').value = '';
    document.getElementById('formLancTitle').textContent = 'Novo Lançamento';
    document.getElementById('divDadosLancamento').style.display = 'block';
    document.getElementById('divMensagemFerias').style.display = 'none';
    
    // Reabilita todos os campos
    document.getElementById('lancColaborador').disabled = false;
    document.getElementById('lancMes').disabled = false;
    document.getElementById('lancFerias').disabled = false;
    document.getElementById('lancRemuneracao').disabled = false;
    document.getElementById('lancBonificacao').disabled = false;
    document.getElementById('lancAdiantamentoEspecie').disabled = false;
    document.getElementById('lancAdiantamentoContab').disabled = false;
    document.getElementById('lancHorasExtras').disabled = false;
    document.getElementById('lancValeTransporte').disabled = false;
    document.getElementById('lancEmprestimo').disabled = false;
    document.getElementById('lancOutros').disabled = false;
    document.getElementById('lancPagamentoContab').disabled = false;
    document.getElementById('lancPagamentoEspecie').disabled = false;
    
    // Reexibe botão salvar
    const btnSalvar = document.querySelector('#formLancamento button[type="submit"]');
    if (btnSalvar) btnSalvar.style.display = '';
    
    // Restaura texto do botão cancelar
    const btnCancelar = document.getElementById('btnCancelarLanc');
    if (btnCancelar) btnCancelar.innerHTML = '<i class="fas fa-times"></i> Cancelar';
}

function calcularTotalRecebido() {
    const salario = parseFloat(document.getElementById('lancRemuneracao').value) || 0;
    const premio = parseFloat(document.getElementById('lancBonificacao').value) || 0;
    
    const total = salario + premio;
    document.getElementById('lancTotalRecebido').value = total.toFixed(2);
    
    calcularLiquidoTotal();
}

function calcularLiquidoTotal() {
    const totalRecebido = parseFloat(document.getElementById('lancTotalRecebido').value) || 0;
    const horasExtras = parseFloat(document.getElementById('lancHorasExtras').value) || 0;
    const valeTransporte = parseFloat(document.getElementById('lancValeTransporte').value) || 0;
    const emprestimo = parseFloat(document.getElementById('lancEmprestimo').value) || 0;
    const outros = parseFloat(document.getElementById('lancOutros').value) || 0;
    
    // Líquido = Total Recebido + Horas Extras - Vale Transporte - Empréstimo - Outros
    const liquido = totalRecebido + horasExtras - valeTransporte - emprestimo - outros;
    document.getElementById('lancLiquidoTotal').value = liquido.toFixed(2);
    
    // Pagamento Espécie NÃO é calculado automaticamente
    // Ele fica fixo como foi preenchido (remuneração + prêmio)
}

function renderizarLancamentos() {
    const tbody = document.getElementById('tabelaLancamentos');
    if (!tbody) return;
    
    tbody.innerHTML = lancamentos.map(l => {
        const c = colaboradores.find(co => co.id === l.colaboradorId);
        const statusBadge = l.status === 'finalizado' 
            ? '<span class="badge bg-success">Finalizado</span>'
            : '<span class="badge bg-warning">Em Aberto</span>';
        
        const acoes = l.status === 'aberto' 
            ? `
                <button class="btn btn-sm btn-warning" onclick="editarLancamento('${l.id}')" title="Editar lançamento">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-success" onclick="finalizarLancamento('${l.id}')" title="Finalizar lançamento">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="excluirLancamento('${l.id}')" title="Excluir lançamento">
                    <i class="fas fa-trash"></i>
                </button>
            `
            : `
                <button class="btn btn-sm btn-info" onclick="visualizarLancamento('${l.id}')" title="Visualizar lançamento (somente leitura)">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-primary" onclick="gerarRecibo('${l.id}')" title="Gerar recibo de pagamento">
                    <i class="fas fa-file-alt"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="reabrirLancamento('${l.id}')" title="Reabrir para edição">
                    <i class="fas fa-undo"></i>
                </button>
            `;
        
        return `
        <tr>
            <td>${c ? c.nome : 'Desconhecido'}</td>
            <td>${formatarMesAno(l.mes)}</td>
            <td>${formatarMoeda(l.liquidoTotal || 0)}</td>
            <td>${statusBadge}</td>
            <td class="text-center">${acoes}</td>
        </tr>
    `}).join('');
}

function editarLancamento(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;

    document.getElementById('lancEditId').value = l.id;
    document.getElementById('lancColaborador').value = l.colaboradorId;
    document.getElementById('lancMes').value = l.mes;
    document.getElementById('lancFerias').value = l.ferias;
    document.getElementById('lancRemuneracao').value = l.remuneracao || l.salario || 0;
    document.getElementById('lancBonificacao').value = l.bonificacao || l.premio || 0;
    document.getElementById('lancTotalRecebido').value = l.totalRecebido || 0;
    document.getElementById('lancAdiantamentoEspecie').value = l.adiantamentoEspecie || 0;
    document.getElementById('lancAdiantamentoContab').value = l.adiantamentoContab || 0;
    document.getElementById('lancHorasExtras').value = l.horasExtras || 0;
    document.getElementById('lancValeTransporte').value = l.valeTransporte || 0;
    document.getElementById('lancEmprestimo').value = l.emprestimo || 0;
    document.getElementById('lancOutros').value = l.outros || 0;
    document.getElementById('lancLiquidoTotal').value = l.liquidoTotal || 0;
    document.getElementById('lancPagamentoContab').value = l.pagamentoContab || 0;
    document.getElementById('lancPagamentoEspecie').value = l.pagamentoEspecie || 0;
    
    if (l.ferias === 'Férias') {
        document.getElementById('divDadosLancamento').style.display = 'none';
        document.getElementById('divMensagemFerias').style.display = 'block';
    } else {
        document.getElementById('divDadosLancamento').style.display = 'block';
        document.getElementById('divMensagemFerias').style.display = 'none';
    }
    
    calcularTotalRecebido();
    calcularLiquidoTotal();
    document.getElementById('formLancTitle').textContent = 'Editar Lançamento';
    window.scrollTo(0, 0);
}

function visualizarLancamento(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;

    // Preenche os campos
    document.getElementById('lancEditId').value = l.id;
    document.getElementById('lancColaborador').value = l.colaboradorId;
    document.getElementById('lancMes').value = l.mes;
    document.getElementById('lancFerias').value = l.ferias;
    document.getElementById('lancRemuneracao').value = l.remuneracao || l.salario || 0;
    document.getElementById('lancBonificacao').value = l.bonificacao || l.premio || 0;
    document.getElementById('lancTotalRecebido').value = l.totalRecebido || 0;
    document.getElementById('lancAdiantamentoEspecie').value = l.adiantamentoEspecie || 0;
    document.getElementById('lancAdiantamentoContab').value = l.adiantamentoContab || 0;
    document.getElementById('lancHorasExtras').value = l.horasExtras || 0;
    document.getElementById('lancValeTransporte').value = l.valeTransporte || 0;
    document.getElementById('lancEmprestimo').value = l.emprestimo || 0;
    document.getElementById('lancOutros').value = l.outros || 0;
    document.getElementById('lancLiquidoTotal').value = l.liquidoTotal || 0;
    document.getElementById('lancPagamentoContab').value = l.pagamentoContab || 0;
    document.getElementById('lancPagamentoEspecie').value = l.pagamentoEspecie || 0;
    
    // Desabilita todos os campos para apenas visualização
    document.getElementById('lancColaborador').disabled = true;
    document.getElementById('lancMes').disabled = true;
    document.getElementById('lancFerias').disabled = true;
    document.getElementById('lancRemuneracao').disabled = true;
    document.getElementById('lancBonificacao').disabled = true;
    document.getElementById('lancAdiantamentoEspecie').disabled = true;
    document.getElementById('lancAdiantamentoContab').disabled = true;
    document.getElementById('lancHorasExtras').disabled = true;
    document.getElementById('lancValeTransporte').disabled = true;
    document.getElementById('lancEmprestimo').disabled = true;
    document.getElementById('lancOutros').disabled = true;
    document.getElementById('lancPagamentoContab').disabled = true;
    document.getElementById('lancPagamentoEspecie').disabled = true;
    
    // Esconde botão salvar e muda texto do cancelar
    const btnSalvar = document.querySelector('#formLancamento button[type="submit"]');
    if (btnSalvar) btnSalvar.style.display = 'none';
    
    const btnCancelar = document.getElementById('btnCancelarLanc');
    if (btnCancelar) btnCancelar.textContent = 'Fechar';
    
    if (l.ferias === 'Férias') {
        document.getElementById('divDadosLancamento').style.display = 'none';
        document.getElementById('divMensagemFerias').style.display = 'block';
    } else {
        document.getElementById('divDadosLancamento').style.display = 'block';
        document.getElementById('divMensagemFerias').style.display = 'none';
    }
    
    document.getElementById('formLancTitle').textContent = 'Visualizar Lançamento (Somente Leitura)';
    window.scrollTo(0, 0);
}

function editarLancamentoDash(id) {
    // Redireciona para a página de lançamentos e edita
    window.location.href = `lancamentos.html?editar=${id}`;
}

function editarColaboradorDash(id) {
    // Redireciona para a página de colaboradores e edita
    window.location.href = `colaboradores.html?editar=${id}`;
}

async function finalizarLancamento(id) {
    if (!confirm('Finalizar lançamento?')) return;
    
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}/finalizar`, {
            method: 'PUT'
        });

        if (response.ok) {
            alert('Lançamento finalizado!');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao finalizar lançamento');
    }
}

async function reabrirLancamento(id) {
    if (!confirm('Reabrir lançamento?')) return;
    
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}/reabrir`, {
            method: 'PUT'
        });

        if (response.ok) {
            alert('Lançamento reaberto!');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao reabrir lançamento');
    }
}

async function excluirLancamento(id) {
    if (!confirm('Excluir lançamento?')) return;
    
    try {
        const response = await fetch(`${API_URL}/lancamentos/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            alert('Lançamento excluído!');
            await carregarDados();
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao excluir lançamento');
    }
}

function atualizarSelectColaboradores() {
    const select = document.getElementById('lancColaborador');
    if (!select) return;
    
    const options = colaboradores.map(c => 
        `<option value="${c.id}">${c.nome}</option>`
    ).join('');
    select.innerHTML = '<option value="">Selecione</option>' + options;
}

function gerarRecibo(id) {
    const l = lancamentos.find(lanc => lanc.id === id);
    if (!l) return;
    const c = colaboradores.find(co => co.id === l.colaboradorId);
    if (!c) return;

    document.getElementById('reciboNome').textContent = c.nome;
    document.getElementById('reciboCPF').textContent = c.cpf;
    document.getElementById('reciboValor').textContent = l.pagamentoEspecie.toFixed(2);
    document.getElementById('reciboData').textContent = new Date().toLocaleDateString('pt-BR');
    document.getElementById('reciboMes').textContent = formatarMesAno(l.mes);

    const modal = new bootstrap.Modal(document.getElementById('modalRecibo'));
    modal.show();
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
            </script>
        </body>
        </html>
    `);
    janela.document.close();
}

// ==================== DASHBOARD ====================

function renderizarDashboard() {
    // Configurar mês atual como padrão
    const mesAtual = new Date().toISOString().substring(0, 7);
    const filtroMesInput = document.getElementById('filtroMes');
    if (!filtroMesInput.value) {
        filtroMesInput.value = mesAtual;
    }
    
    atualizarSelectFiltros();
    aplicarFiltrosDashboard();
}

function atualizarSelectFiltros() {
    const select = document.getElementById('filtroColaborador');
    if (!select) return;
    const options = colaboradores.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    select.innerHTML = '<option value="">Todos</option>' + options;
}

function aplicarFiltrosDashboard() {
    const tipo = document.getElementById('filtroTipo').value;
    const mes = document.getElementById('filtroMes').value;
    const colabId = document.getElementById('filtroColaborador').value;
    
    // Mostrar/esconder filtro de colaborador
    const divFiltroColab = document.getElementById('divFiltroColaborador');
    if (tipo === 'lancamentos') {
        divFiltroColab.style.display = 'block';
    } else {
        divFiltroColab.style.display = 'none';
    }
    
    // Mostrar/esconder tabelas
    const tabelaColabContainer = document.getElementById('tabelaColaboradoresContainer');
    const tabelaLancContainer = document.getElementById('tabelaLancamentosContainer');
    
    if (tipo === 'colaboradores') {
        tabelaColabContainer.style.display = 'block';
        tabelaLancContainer.style.display = 'none';
        renderizarColaboradoresDash();
    } else {
        tabelaColabContainer.style.display = 'none';
        tabelaLancContainer.style.display = 'block';
        renderizarLancamentosDash(mes, colabId);
    }
    
    // Atualizar cards
    atualizarCardsDashboard(tipo, mes, colabId);
}

function atualizarCardsDashboard(tipo, mes, colabId) {
    // Filtrar lançamentos pelo mês se estiver selecionado
    let lancamentosFiltrados = [...lancamentos];
    
    if (mes) {
        lancamentosFiltrados = lancamentosFiltrados.filter(l => l.mes === mes);
    }
    
    if (colabId) {
        lancamentosFiltrados = lancamentosFiltrados.filter(l => l.colaboradorId === colabId);
    }
    
    if (tipo === 'colaboradores') {
        // Modo Colaboradores
        document.getElementById('iconStat1').className = 'stat-icon fas fa-users text-primary';
        document.getElementById('labelStat1').textContent = 'Colaboradores';
        document.getElementById('valueStat1').textContent = colaboradores.length;
        
        document.getElementById('iconStat2').className = 'stat-icon fas fa-list text-info';
        document.getElementById('labelStat2').textContent = 'Lançamentos';
        document.getElementById('valueStat2').textContent = lancamentosFiltrados.length;
        
        document.getElementById('tipoResultado').textContent = 'Colaboradores';
        document.getElementById('countResultados').textContent = colaboradores.length;
        
    } else {
        // Modo Lançamentos
        document.getElementById('iconStat1').className = 'stat-icon fas fa-users text-primary';
        document.getElementById('labelStat1').textContent = 'Colaboradores';
        document.getElementById('valueStat1').textContent = colaboradores.length;
        
        document.getElementById('iconStat2').className = 'stat-icon fas fa-list text-info';
        document.getElementById('labelStat2').textContent = 'Lançamentos';
        document.getElementById('valueStat2').textContent = lancamentosFiltrados.length;
        
        document.getElementById('tipoResultado').textContent = 'Lançamentos';
        document.getElementById('countResultados').textContent = lancamentosFiltrados.length;
    }
    
    // Cards de valores (sempre com base nos lançamentos já filtrados)
    const totalAdiantamento = lancamentosFiltrados.reduce((sum, l) => {
        const adiantamentoEspecie = l.adiantamentoEspecie || 0;
        const adiantamentoContab = l.adiantamentoContab || 0;
        return sum + adiantamentoEspecie + adiantamentoContab;
    }, 0);
    
    // Líquido Espécie = Pagamento Espécie - Adiantamentos
    const totalPagamentoEspecie = lancamentosFiltrados.reduce((sum, l) => sum + (l.pagamentoEspecie || 0), 0);
    const totalLiquidoEspecie = totalPagamentoEspecie - totalAdiantamento;
    
    const totalGeral = totalAdiantamento + totalPagamentoEspecie;
    
    document.getElementById('valueStat3').textContent = formatarMoeda(totalAdiantamento);
    document.getElementById('valueStat4').textContent = formatarMoeda(totalLiquidoEspecie);
    document.getElementById('valueStat5').textContent = formatarMoeda(totalGeral);
}

function renderizarColaboradoresDash() {
    const tbody = document.getElementById('tabelaColaboradoresDash');
    if (!tbody) return;
    
    tbody.innerHTML = colaboradores.map(c => {
        const badgeColor = c.contratacao === 'CLT' ? 'primary' : 
                          c.contratacao === 'Mensalista' ? 'success' : 'info';
        return `
        <tr>
            <td>${c.nome}</td>
            <td>${c.cpf}</td>
            <td>${c.funcao || '-'}</td>
            <td><span class="badge bg-${badgeColor}">${c.contratacao}</span></td>
            <td>${formatarMoeda(c.total || c.remuneracao || 0)}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-primary" onclick="editarColaboradorDash('${c.id}')" title="Editar colaborador">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `}).join('');
}

function renderizarLancamentosDash(mes, colabId) {
    const tbody = document.getElementById('tabelaLancamentosDash');
    if (!tbody) return;
    
    let lancamentosFiltrados = [...lancamentos];
    
    if (mes) {
        lancamentosFiltrados = lancamentosFiltrados.filter(l => l.mes === mes);
    }
    
    if (colabId) {
        lancamentosFiltrados = lancamentosFiltrados.filter(l => l.colaboradorId === colabId);
    }
    
    tbody.innerHTML = lancamentosFiltrados.map(l => {
        const c = colaboradores.find(co => co.id === l.colaboradorId);
        const badge = l.status === 'finalizado' 
            ? '<span class="badge bg-success">Finalizado</span>'
            : '<span class="badge bg-warning text-dark">Em Aberto</span>';
        
        // Botão de visualizar - se finalizado só visualiza, se aberto pode editar
        const btnAcao = l.status === 'finalizado'
            ? `<button class="btn btn-sm btn-info" onclick="visualizarLancamento('${l.id}')" title="Visualizar lançamento (somente leitura)">
                <i class="fas fa-eye"></i>
               </button>`
            : `<button class="btn btn-sm btn-primary" onclick="editarLancamentoDash('${l.id}')" title="Editar lançamento">
                <i class="fas fa-eye"></i>
               </button>`;
        
        return `
            <tr>
                <td>${c ? c.nome : 'Desconhecido'}</td>
                <td>${formatarMesAno(l.mes)}</td>
                <td>${formatarMoeda(l.totalRecebido || 0)}</td>
                <td>${formatarMoeda(l.adiantamento || 0)}</td>
                <td>${formatarMoeda(l.pagamentoEspecie || 0)}</td>
                <td>${badge}</td>
                <td class="text-center">${btnAcao}</td>
            </tr>
        `;
    }).join('');
}

function limparFiltros() {
    document.getElementById('filtroTipo').value = 'colaboradores';
    document.getElementById('filtroMes').value = new Date().toISOString().substring(0, 7);
    document.getElementById('filtroColaborador').value = '';
    aplicarFiltrosDashboard();
}

// ==================== EXPORTAÇÃO CSV ====================

function exportarCSV() {
    const mesFiltro = document.getElementById('filtroMesCSV').value;
    
    if (!mesFiltro) {
        alert('Por favor, selecione um mês para exportar!');
        return;
    }
    
    // Filtrar lançamentos do mês
    const lancamentosMes = lancamentos.filter(l => l.mes === mesFiltro);
    
    if (lancamentosMes.length === 0) {
        alert('Não há lançamentos para o mês selecionado!');
        return;
    }
    
    // Cabeçalho do CSV com ponto e vírgula
    let csv = 'Nome;Adiantamento Contabilidade;Adiantamento Espécie;Pagamento Contabilidade;Pagamento Espécie\n';
    
    // Adicionar dados
    lancamentosMes.forEach(l => {
        const colaborador = colaboradores.find(c => c.id === l.colaboradorId);
        const nome = colaborador ? colaborador.nome : 'Desconhecido';
        const adiantamentoContab = (l.adiantamentoContab || 0).toFixed(2).replace('.', ',');
        const adiantamentoEspecie = (l.adiantamentoEspecie || 0).toFixed(2).replace('.', ',');
        const pagamentoContab = (l.pagamentoContab || 0).toFixed(2).replace('.', ',');
        const pagamentoEspecie = (l.pagamentoEspecie || 0).toFixed(2).replace('.', ',');
        
        csv += `${nome};${adiantamentoContab};${adiantamentoEspecie};${pagamentoContab};${pagamentoEspecie}\n`;
    });
    
    // Adicionar BOM UTF-8 para Excel reconhecer caracteres especiais
    const BOM = '\uFEFF';
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
    
    alert(`CSV exportado com sucesso!\n${lancamentosMes.length} lançamento(s) do mês ${formatarMesAno(mesFiltro)}`);
}

// ==================== UTILITÁRIOS ====================

function formatarMoeda(valor) {
    return 'R$ ' + parseFloat(valor).toFixed(2).replace('.', ',');
}

function formatarMesAno(mesAno) {
    if (!mesAno) return '-';
    const [ano, mes] = mesAno.split('-');
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${meses[parseInt(mes) - 1]}/${ano}`;
}