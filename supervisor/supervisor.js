
// =====================================================================
// TELA: SUPERVISOR
// =====================================================================
//
// Acesso restrito a gestores.
// =====================================================================

exigirPapel(["gestor"]);

// O ../shared/supabaseClient.js já fornece:
// - supabaseClient
// - TABELAS
// - STATUS
// - classificarMaquina()
// =====================================================================


// =====================================================================
// ELEMENTOS DA TELA
// =====================================================================

const tabelaMaquinas = document.getElementById("tabela-maquinas");
const tabelaOperadores = document.getElementById("tabela-operadores");
const totalOperadores = document.getElementById("total-operadores");
const paretoChart = document.getElementById("pareto-chart");
const kpiRodando = document.getElementById("kpi-rodando");
const kpiParadas = document.getElementById("kpi-paradas");
const kpiSetup = document.getElementById("kpi-setup");
const kpiLinhaDestaque = document.getElementById("kpi-linha-destaque");
const kpiLinhaPior = document.getElementById("kpi-linha-pior");
const kpiLinhaProdutiva = document.getElementById("kpi-linha-produtiva");
const kpiLinhaProdutivaPior = document.getElementById("kpi-linha-produtiva-pior");
const kpiOeeGeral = document.getElementById("kpi-oee-geral");
const kpiAtendimentoMeta = document.getElementById("kpi-atendimento-meta");
const lastUpdateEl = document.getElementById("last-update");
const connectionPill = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");
const botoesFiltro = document.querySelectorAll("[data-filtro]");
const producaoLinhas = document.getElementById("producao-linhas");
const producaoSelectTurno = document.getElementById("producao-select-turno");
const oeeDosadoras = document.getElementById("oee-dosadoras");
const oeeMedioDosadoras = document.getElementById("oee-medio-dosadoras");
const selectLinha = document.getElementById("pareto-select-linha");
const selectMaquina = document.getElementById("pareto-select-maquina");

let filtroAtual = "todas";
let grupoAtual = "todas";
let maquinaAtual = "todas";
let turnoProducaoAtual = "todos";
let motivoSelecionadoPareto = null; // drill-down: motivo clicado no Pareto (null = visão normal)
let ultimasMaquinas = [];
let ultimoMapaTempoParado = {};
let ultimasParadasHoje = [];
let ultimaProducaoHoraria = [];
let ultimosTurnosConfig = [];
let ultimoErroProducaoHoraria = null;
let ultimosRegistrosHorariosPorMaquina = {};


// grupoDaLinha() agora vem de shared/supabaseClient.js (fonte única,
// reaproveitada pelo Gestor também).


// =====================================================================
// STATUS DA CONEXÃO
// =====================================================================

function setConexao(estado) {
    connectionPill.classList.remove("online", "erro");
    if (estado === "online") {
        connectionPill.classList.add("online");
        connectionText.textContent = "ao vivo";
    } else if (estado === "erro") {
        connectionPill.classList.add("erro");
        connectionText.textContent = "erro de conexão";
    } else {
        connectionText.textContent = "conectando...";
    }
}

function formatarHora(data) {
    return new Date(data).toLocaleTimeString(
        "pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    );
}

function minutosParado(parada) {
    if (parada.duration_min != null) return Number(parada.duration_min);
    return (Date.now() - new Date(parada.started_at).getTime()) / 60000;
}

// escapa texto pra usar dentro de um atributo HTML (ex.: data-motivo="...")
// sem quebrar o markup se o motivo tiver aspas, & ou <>
function escapeAtributoHtml(texto) {
    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatarDuracao(minutos) {
    const m = Math.round(minutos);
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    const resto = m % 60;
    return `${h}h ${resto}min`;
}

function tempoDecorrido(desde) {
    if (!desde) return "—";
    return formatarDuracao((Date.now() - new Date(desde).getTime()) / 60000);
}


// =====================================================================
// CARREGAR DADOS
// =====================================================================

async function carregar() {

    try {

        setConexao("conectando");

        const { data: maquinas, error: erroMaquinas } = await supabaseClient
            .from(TABELAS.MACHINES)
            .select("*");

        const { data: paradasAbertas, error: erroParadas } = await supabaseClient
            .from(TABELAS.STOPS)
            .select("*")
            .is("ended_at", null)
            .order("started_at", { ascending: true });

        if (erroMaquinas || erroParadas) {
            console.error(erroMaquinas || erroParadas);
            setConexao("erro");
            return;
        }

        const agora = new Date();
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

        const { data: paradasHoje, error: erroParadasHoje } = await supabaseClient
            .from(TABELAS.STOPS)
            .select("*")
            .gte("started_at", inicioHoje.toISOString());

        if (erroParadasHoje) {
            console.error("Erro ao buscar paradas do dia:", erroParadasHoje);
        }

        const { data: producaoHorariaHoje, error: erroProducao } = await supabaseClient
            .from(TABELAS.PRODUCAO_HORARIA)
            .select("machine_id, turno, qtde_produzida, qtde_rejeitada, qtde_teorica, indice_disponibilidade, indice_performance, indice_qualidade, oee_hora, hora")
            .gte("hora", inicioHoje.toISOString());

        if (erroProducao) {
            console.error("Erro ao buscar produção horária:", erroProducao);
        }

        ultimoErroProducaoHoraria = erroProducao || null;

        const { data: turnosConfigData, error: erroTurnos } = await supabaseClient
            .from(TABELAS.TURNOS_CONFIG)
            .select("*");

        if (erroTurnos) {
            console.error("Erro ao buscar turnos_config:", erroTurnos);
        }

        const { data: stopReasonsData, error: erroMotivos } = await supabaseClient
            .from(TABELAS.STOP_REASONS)
            .select("*");

        if (erroMotivos) {
            console.error("Erro ao buscar stop_reasons:", erroMotivos);
        }

        const turnosConfig = turnosConfigData || [];
        const mapaMotivos = construirMapaMotivos(stopReasonsData || []);

        const listaMaquinas = maquinas || [];
        const listaParadas = paradasAbertas || [];
        const listaParadasHoje = paradasHoje || [];

        // tempo parado hoje, somado por máquina (pra mostrar na tabela)
        const mapaTempoParado = {};
        listaParadasHoje.forEach(p => {
            const id = Number(p.machine_id);
            mapaTempoParado[id] = (mapaTempoParado[id] || 0) + minutosParado(p);
        });

        ultimasMaquinas = listaMaquinas;
        ultimoMapaTempoParado = mapaTempoParado;
        ultimasParadasHoje = listaParadasHoje;
        ultimaProducaoHoraria = producaoHorariaHoje || [];
        ultimosTurnosConfig = turnosConfig;

        atualizarSeletorMaquina();
        atualizarSeletorTurnoProducao();
        const producaoTotal = calcularProducaoPorMaquina("todos");
        const refugoTotal = calcularRefugoPorMaquina("todos");

        // OEE calculado pelo próprio painel, com agenda fixa por linha
        // (ver shared/supabaseClient.js) — agrupa as linhas de hoje de
        // producao_horaria por máquina, pra achar as horas certas
        // (05:30–22:30 pra Linha 1, 07–17/07–16 sexta pras demais).
        const registrosHorariosPorMaquina = {};
        ultimaProducaoHoraria.forEach(r => {
            const id = Number(r.machine_id);
            if (!registrosHorariosPorMaquina[id]) registrosHorariosPorMaquina[id] = [];
            registrosHorariosPorMaquina[id].push(r);
        });
        ultimosRegistrosHorariosPorMaquina = registrosHorariosPorMaquina;

        renderizarKPIs(listaMaquinas, producaoTotal, registrosHorariosPorMaquina, agora);
        renderizarMaquinas(listaMaquinas, mapaTempoParado, producaoTotal, refugoTotal, registrosHorariosPorMaquina, agora);
        renderizarOperadores(listaMaquinas);
        renderizarProducaoPorLinha();
        renderizarOeePorLinha(listaMaquinas, registrosHorariosPorMaquina, agora);
        renderizarPareto();

        if (lastUpdateEl) lastUpdateEl.textContent = formatarHora(new Date());
        setConexao("online");

    } catch (erro) {
        console.error("Erro ao carregar supervisor:", erro);
        setConexao("erro");
    }
}


// =====================================================================
// KPIs DE TOPO
// =====================================================================

// calcularOeePorLinha() e mediaDeLinhas() agora vêm de
// shared/supabaseClient.js (fonte única, reaproveitada pelo Gestor
// também).

function renderizarKPIs(maquinas, producaoPorMaquina, registrosHorariosPorMaquina, agora) {

    let rodando = 0, parada = 0, setup = 0;

    maquinas.forEach(m => {
        const classe = classificarMaquina(m);
        if (classe === "rodando") rodando++;
        else if (classe === "setup") setup++;
        else parada++;
    });

    if (kpiRodando) kpiRodando.textContent = rodando;
    if (kpiParadas) kpiParadas.textContent = parada;
    if (kpiSetup) kpiSetup.textContent = setup;

    // OEE geral da fábrica = EXATAMENTE a mesma conta do "OEE médio" que
    // aparece no painel "OEE por Linha" logo abaixo (média das 5 linhas,
    // não das 10 máquinas soltas) — os dois cards precisam sempre
    // mostrar o mesmo número, então usam a mesma função em vez de duas
    // contas separadas que podiam divergir (ex.: a Linha 4 tem 3
    // máquinas e a Linha 5 só 1 — uma média "achatada" por máquina dava
    // um resultado diferente da média por linha).
    const { oeePorLinha } = calcularOeePorLinha(maquinas, registrosHorariosPorMaquina, agora);
    const oeeGeral = mediaDeLinhas(oeePorLinha);

    if (kpiOeeGeral) {
        kpiOeeGeral.textContent = oeeGeral != null
            ? Math.round(oeeGeral) + "%"
            : "—";
    }

    // "Linha de destaque" = linha com o MAIOR OEE consolidado (média
    // simples do OEE já corrigido de Dosadora + Plissadeira daquela
    // linha — mesma fórmula do painel "OEE por Linha" logo abaixo).
    let linhaMaiorOee = null;
    let maiorOee = -1;
    let linhaMenorOee = null;
    let menorOee = Infinity;

    Object.entries(oeePorLinha).forEach(([numeroLinha, valor]) => {
        if (valor == null || isNaN(valor)) return;
        if (valor > maiorOee) {
            maiorOee = valor;
            linhaMaiorOee = numeroLinha;
        }
        if (valor < menorOee) {
            menorOee = valor;
            linhaMenorOee = numeroLinha;
        }
    });

    if (kpiLinhaDestaque) {
        kpiLinhaDestaque.textContent = linhaMaiorOee != null
            ? `Linha ${linhaMaiorOee} · ${maiorOee.toFixed(1)}% OEE`
            : "—";
    }

    if (kpiLinhaPior) {
        kpiLinhaPior.textContent = linhaMenorOee != null && linhaMaiorOee !== linhaMenorOee
            ? `Pior: Linha ${linhaMenorOee} · ${menorOee.toFixed(1)}% OEE`
            : "—";
    }

    // "Linha mais produtiva" = linha com a MAIOR quantidade de peças
    // produzidas hoje (só Dosadora — mesmo critério do painel "Produção
    // por Linha"). Isso é produção real, não tem relação com OEE — uma
    // linha pode produzir muito mesmo sem ser a de melhor OEE, e
    // vice-versa.
    const producaoPorLinha = {};

    maquinas.forEach(m => {
        const grupo = grupoDaLinha(m.line);
        if (!grupo) return;

        const ehDosadora = (m.line || "").toUpperCase().includes("DOSADORA");
        if (!ehDosadora) return;

        producaoPorLinha[grupo] = (producaoPorLinha[grupo] || 0) + (producaoPorMaquina[Number(m.id)] || 0);
    });

    let melhorLinha = null;
    let melhorValor = -1;
    let piorLinha = null;
    let piorValor = Infinity;

    Object.entries(producaoPorLinha).forEach(([numeroLinha, valor]) => {
        if (valor > melhorValor) {
            melhorValor = valor;
            melhorLinha = numeroLinha;
        }
        if (valor < piorValor) {
            piorValor = valor;
            piorLinha = numeroLinha;
        }
    });

    if (kpiLinhaProdutiva) {
        kpiLinhaProdutiva.textContent = melhorLinha && melhorValor > 0
            ? `Linha ${melhorLinha} · ${melhorValor.toLocaleString("pt-BR")} pçs`
            : "—";
    }

    if (kpiLinhaProdutivaPior) {
        kpiLinhaProdutivaPior.textContent = piorLinha && melhorLinha !== piorLinha
            ? `Pior: Linha ${piorLinha} · ${piorValor.toLocaleString("pt-BR")} pçs`
            : "—";
    }

    const totalProduzido = Object.values(producaoPorLinha).reduce((soma, v) => soma + v, 0);
    const totalMeta = Object.values(METAS_DIARIAS_POR_LINHA).reduce((soma, v) => soma + v, 0);

    if (kpiAtendimentoMeta) {
        kpiAtendimentoMeta.textContent = totalMeta > 0
            ? Math.round((totalProduzido / totalMeta) * 100) + "%"
            : "—";
    }
}


// =====================================================================
// PARADAS POR TURNO — hoje
// =====================================================================

// =====================================================================
// TABELA DE MÁQUINAS
// =====================================================================

// =====================================================================
// OPERADORES — agrupado por operador, não por máquina
// =====================================================================
//
// Aproximação: o EGA só nos dá o operador ATUAL de cada máquina
// (TABCACHE.NOME_OPERADOR), sem histórico de troca de operador no
// meio do dia. Então "produção hoje" aqui é a soma de tudo que as
// máquinas que ele toca AGORA produziram hoje — se ele trocou de
// máquina no meio do turno, isso não é capturado. É a melhor
// aproximação possível com os dados atuais.
// =====================================================================

function renderizarOperadores(maquinas) {

    if (!tabelaOperadores) return;

    const producaoPorMaquina = calcularProducaoPorMaquina("todos");

    const porOperador = {};

    maquinas.forEach(m => {
        const nome = (m.operator || "").trim();
        if (!nome || nome.toUpperCase() === "SEM OPERADOR") return;

        if (!porOperador[nome]) {
            porOperador[nome] = { maquinas: [], produzido: 0 };
        }

        porOperador[nome].maquinas.push(m);
        porOperador[nome].produzido += producaoPorMaquina[Number(m.id)] || 0;
    });

    const operadores = Object.entries(porOperador)
        .sort((a, b) => b[1].produzido - a[1].produzido);

    if (totalOperadores) totalOperadores.textContent = `${operadores.length} operadores`;

    if (!operadores.length) {
        tabelaOperadores.innerHTML = '<tr><td colspan="3" class="empty-message">Nenhum operador identificado nas máquinas agora.</td></tr>';
        return;
    }

    tabelaOperadores.innerHTML = operadores.map(([nome, dados]) => {

        const linhas = dados.maquinas.map(m => m.line).join(", ");

        return `
            <tr>
                <td class="strong">${nome}</td>
                <td>${linhas}</td>
                <td class="strong">${dados.produzido.toLocaleString("pt-BR")}</td>
            </tr>
        `;
    }).join("");
}


function renderizarMaquinas(maquinas, mapaTempoParado, producaoPorMaquina, refugoPorMaquina, registrosHorariosPorMaquina, agora) {

    if (!tabelaMaquinas) return;

    const filtradas = filtroAtual === "todas"
        ? maquinas
        : maquinas.filter(m => classificarMaquina(m) === filtroAtual);

    if (!filtradas.length) {
        tabelaMaquinas.innerHTML = '<tr><td colspan="9" class="empty-message">Nenhuma máquina neste filtro.</td></tr>';
        return;
    }

    const ordenadas = [...filtradas].sort((a, b) => Number(a.id) - Number(b.id));

    tabelaMaquinas.innerHTML = ordenadas.map(m => {

        const classe = classificarMaquina(m);
        const label = classe === "rodando" ? "Rodando" : classe === "setup" ? "Setup" : "Parada";

        const produzido = Number(m.produced) || 0;
        const target = Number(m.target) || 0;
        const pct = target > 0 ? Math.min(100, Math.round((produzido / target) * 100)) : 0;

        const pecasNoDia = producaoPorMaquina[Number(m.id)] || 0;

        const { valor: oeeValor } = calcularOeeMaquinaV2(m, registrosHorariosPorMaquina, agora);

        const minutosHoje = mapaTempoParado[Number(m.id)] || 0;
        const tempoParadoHoje = minutosHoje > 0 ? formatarDuracao(minutosHoje) : "—";
        const criticaHoje = minutosHoje >= 120;

        return `
            <tr class="linha-maquina ${criticaHoje ? "linha-critica" : ""}" data-id="${m.id}">
                <td class="strong">${m.line || "—"}</td>
                <td><span class="badge ${classe}">${label}</span></td>
                <td>${m.operator || "—"}</td>
                <td>${m.op || "—"}</td>
                <td class="celula-producao">
                    <div class="mini-progress-bg">
                        <div class="mini-progress-fill" style="width:${pct}%"></div>
                    </div>
                    <span>${produzido} / ${target} (${pct}%)</span>
                </td>
                <td class="strong">${pecasNoDia.toLocaleString("pt-BR")}</td>
                <td>${oeeValor != null ? oeeValor.toFixed(1) + "%" : "—"}</td>
                <td class="${criticaHoje ? "texto-critico" : ""}">${tempoParadoHoje}</td>
                <td>${classe !== "rodando" ? (m.reason || "—") : "—"}</td>
            </tr>
        `;
    }).join("");

    tabelaMaquinas.querySelectorAll(".linha-maquina").forEach(tr => {
        tr.addEventListener("click", () => {
            window.location.href = `../maquinas/minha_maquina.html?id=${tr.dataset.id}`;
        });
    });
}


// =====================================================================
// PARADAS EM ABERTO
// =====================================================================


// =====================================================================
// PRODUÇÃO POR LINHA — soma produzido hoje e meta atual por grupo
// =====================================================================

function atualizarSeletorTurnoProducao() {

    if (!producaoSelectTurno) return;

    const turnosPresentes = [...new Set(
        ultimaProducaoHoraria
            .map(r => r.turno)
            .filter(t => t != null)
    )].sort((a, b) => Number(a) - Number(b));

    const valorAtual = producaoSelectTurno.value || "todos";

    const opcoes = ['<option value="todos">Dia inteiro</option>'];
    turnosPresentes.forEach(t => {
        opcoes.push(`<option value="${t}">${formatarTurno(t, ultimosTurnosConfig)}</option>`);
    });

    producaoSelectTurno.innerHTML = opcoes.join("");

    // mantém a seleção do usuário se ainda for uma opção válida
    if (["todos", ...turnosPresentes.map(String)].includes(valorAtual)) {
        producaoSelectTurno.value = valorAtual;
        turnoProducaoAtual = valorAtual;
    } else {
        producaoSelectTurno.value = "todos";
        turnoProducaoAtual = "todos";
    }
}

if (producaoSelectTurno) {
    producaoSelectTurno.addEventListener("change", () => {
        turnoProducaoAtual = producaoSelectTurno.value;
        renderizarProducaoPorLinha();
    });
}


// =====================================================================
// METAS DIÁRIAS POR LINHA
// =====================================================================
//
// Fixas por enquanto (não vêm de nenhuma tabela do EGA/Supabase — o
// campo machines.target é a meta da OP atual, não uma meta diária por
// linha, e somar target de Dosadora + Plissadeira juntos não fazia
// sentido). Se um dia isso passar a vir de alguma tabela de cadastro,
// é só trocar esse objeto por uma consulta.
// =====================================================================

const METAS_DIARIAS_POR_LINHA = {
    1: 1200,
    2: 900,
    3: 700,
    4: 270,
    5: 900
};

function calcularProducaoPorMaquina(turno) {

    const registros = turno === "todos"
        ? ultimaProducaoHoraria
        : ultimaProducaoHoraria.filter(r => String(r.turno) === String(turno));

    const mapa = {};
    registros.forEach(r => {
        const id = Number(r.machine_id);
        mapa[id] = (mapa[id] || 0) + (Number(r.qtde_produzida) || 0);
    });

    return mapa;
}

function calcularRefugoPorMaquina(turno) {

    const registros = turno === "todos"
        ? ultimaProducaoHoraria
        : ultimaProducaoHoraria.filter(r => String(r.turno) === String(turno));

    const mapa = {};
    registros.forEach(r => {
        const id = Number(r.machine_id);
        mapa[id] = (mapa[id] || 0) + (Number(r.qtde_rejeitada) || 0);
    });

    return mapa;
}

// qtde_teorica somada por máquina — denominador real da Performance,
// vindo de OEE_HORARIO.QTDE_TEORICA (ver SCHEMA_SUPABASE.md). Usado só
// pra consolidar o OEE da LINHA batendo com o relatório do EGA.
function calcularTeoricaPorMaquina(turno) {

    const registros = turno === "todos"
        ? ultimaProducaoHoraria
        : ultimaProducaoHoraria.filter(r => String(r.turno) === String(turno));

    const mapa = {};
    registros.forEach(r => {
        const id = Number(r.machine_id);
        mapa[id] = (mapa[id] || 0) + (Number(r.qtde_teorica) || 0);
    });

    return mapa;
}

// nº de faixas de hora "com produção programada de verdade"
// (qtde_teorica > 0) por máquina — usado como peso de tempo pra
// ponderar a Disponibilidade da linha, já que não sincronizamos os
// segundos brutos de tempo disponível/parado do EGA
function calcularHorasQualificadasPorMaquina(turno) {

    const registros = turno === "todos"
        ? ultimaProducaoHoraria
        : ultimaProducaoHoraria.filter(r => String(r.turno) === String(turno));

    const mapa = {};
    registros.forEach(r => {
        if ((Number(r.qtde_teorica) || 0) <= 0) return;
        const id = Number(r.machine_id);
        mapa[id] = (mapa[id] || 0) + 1;
    });

    return mapa;
}


function renderizarProducaoPorLinha() {

    if (!producaoLinhas) return;

    if (ultimoErroProducaoHoraria) {
        const msg = ultimoErroProducaoHoraria.message || "";
        const tabelaFaltando = msg.toLowerCase().includes("does not exist")
            || msg.toLowerCase().includes("schema cache");

        producaoLinhas.innerHTML = `
            <div class="empty-message">
                ${tabelaFaltando
                    ? 'Tabela <code>producao_horaria</code> não encontrada no Supabase. Rode o CREATE TABLE do SCHEMA_SUPABASE.md e execute o sync.js atualizado.'
                    : `Erro ao buscar produção: ${msg}`}
            </div>
        `;
        return;
    }

    // soma qtde_produzida (producao_horaria) por máquina, filtrando
    // por turno se um turno específico estiver selecionado — em vez do
    // "maior valor do dia" de production_history, que reseta a cada
    // troca de OP e sub-contava a produção real.
    const producaoPorMaquina = calcularProducaoPorMaquina(turnoProducaoAtual);

    const grupos = {};

    ultimasMaquinas.forEach(m => {
        const grupo = grupoDaLinha(m.line);
        if (!grupo) return;

        // produção da linha = só a Dosadora (é ela que conta as peças
        // da linha; Plissadeira mede outra etapa/unidade do processo)
        const ehDosadora = (m.line || "").toUpperCase().includes("DOSADORA");
        if (!ehDosadora) return;

        if (!grupos[grupo]) grupos[grupo] = 0;
        grupos[grupo] += producaoPorMaquina[Number(m.id)] || 0;
    });

    const numeros = [1, 2, 3, 4, 5];

    producaoLinhas.innerHTML = numeros.map(n => {
        const produzido = grupos[n] || 0;
        const meta = METAS_DIARIAS_POR_LINHA[n] || 0;
        const pct = meta > 0 ? Math.min(100, Math.round((produzido / meta) * 100)) : 0;

        return `
            <div class="linha-producao-item">
                <span class="linha-producao-nome">Linha ${n}</span>
                <div class="linha-producao-bar-bg">
                    <div class="linha-producao-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="linha-producao-valor">${produzido.toLocaleString("pt-BR")} / ${meta.toLocaleString("pt-BR")}</span>
            </div>
        `;
    }).join("");
}


// =====================================================================
// OEE — DISPONIBILIDADE DAS DOSADORAS
// =====================================================================

function renderizarOeePorLinha(maquinas, registrosHorariosPorMaquina, agora) {

    if (!oeeDosadoras) return;

    if (!maquinas.length) {
        oeeDosadoras.innerHTML = '<div class="empty-message">Nenhuma máquina encontrada.</div>';
        if (oeeMedioDosadoras) oeeMedioDosadoras.textContent = "—";
        return;
    }

    // =====================================================================
    // OEE DA LINHA = média simples do OEE de cada máquina (Dosadora +
    // Plissadeira), calculado pelo próprio painel a partir dos índices
    // brutos por hora (ID/IP/IQ) e da agenda fixa de cada linha — ver
    // calcularOeeMaquinaV2()/calcularOeeDoDiaPorHoras() em
    // shared/supabaseClient.js.
    // certos, o que aparentemente é a fórmula real do EGA pra linha.
    // =====================================================================

    const { grupos, oeePorLinha } = calcularOeePorLinha(maquinas, registrosHorariosPorMaquina, agora);
    const media = mediaDeLinhas(oeePorLinha);

    if (oeeMedioDosadoras) {
        oeeMedioDosadoras.textContent = media != null ? Math.round(media) + "%" : "—";
    }

    function faixaOee(valor) {
        if (valor == null) return "sem-dado";
        if (valor < 65) return "critico";
        if (valor < 85) return "atencao";
        return "bom";
    }

    const numeros = [1, 2, 3, 4, 5];

    oeeDosadoras.innerHTML = numeros.map(n => {

        const itens = grupos[n] || [];
        const valor = itens.length ? oeePorLinha[n] : null;

        const faixa = faixaOee(valor);
        const pct = valor != null ? Math.min(100, Math.max(0, valor)) : 0;

        const detalhePorMaquina = itens.length
            ? itens
                .map(item => `${item.nome}: ${item.oee.toFixed(1)}%`)
                .join(" · ")
            : "";

        return `
            <div class="oee-item">
                <div class="oee-item-cabecalho">
                    <span class="oee-item-nome">Linha ${n}</span>
                    <span class="oee-item-valor oee-${faixa}">${valor != null ? valor.toFixed(1) + "%" : "—"}</span>
                </div>
                <div class="oee-bar-bg">
                    <div class="oee-bar-fill oee-${faixa}" style="width:${pct}%"></div>
                </div>
                ${detalhePorMaquina ? `<span class="oee-item-detalhe">${detalhePorMaquina}</span>` : ""}
            </div>
        `;
    }).join("");
}


// =====================================================================
// SELETOR DE MÁQUINA — populado dinamicamente conforme a linha escolhida
// =====================================================================

function atualizarSeletorMaquina() {

    if (!selectMaquina) return;

    if (grupoAtual === "todas") {
        selectMaquina.innerHTML = '<option value="todas">Todas as máquinas</option>';
        selectMaquina.disabled = true;
        maquinaAtual = "todas";
        return;
    }

    const maquinasDoGrupo = ultimasMaquinas.filter(
        m => grupoDaLinha(m.line) === Number(grupoAtual)
    );

    selectMaquina.disabled = false;

    const opcoes = [];

    if (maquinasDoGrupo.length > 1) {
        opcoes.push('<option value="todas">Dosadora + Plissadeira</option>');
    }

    maquinasDoGrupo.forEach(m => {
        opcoes.push(`<option value="${m.id}">Somente ${m.line}</option>`);
    });

    // Preserva a escolha do usuário entre atualizações automáticas —
    // só reseta pra "todas" se a máquina escolhida não existir mais
    // nesse grupo (ex.: o usuário trocou de linha de verdade).
    const valoresValidos = maquinasDoGrupo.map(m => String(m.id)).concat("todas");
    const escolhaAindaValida = valoresValidos.includes(String(maquinaAtual));

    selectMaquina.innerHTML = opcoes.join("");

    if (escolhaAindaValida) {
        selectMaquina.value = maquinaAtual;
    } else {
        maquinaAtual = "todas";
    }
}


// =====================================================================
// PARETO DE PARADAS — barras (tempo parado) + linha acumulada (%)
// filtrado por linha e, opcionalmente, por uma máquina específica
// =====================================================================

function renderizarPareto() {

    if (!paretoChart) return;

    let paradasFiltradas = ultimasParadasHoje;

    if (grupoAtual !== "todas") {

        const idsDoGrupo = new Set(
            ultimasMaquinas
                .filter(m => grupoDaLinha(m.line) === Number(grupoAtual))
                .map(m => Number(m.id))
        );

        paradasFiltradas = paradasFiltradas.filter(
            p => idsDoGrupo.has(Number(p.machine_id))
        );

        if (maquinaAtual !== "todas") {
            paradasFiltradas = paradasFiltradas.filter(
                p => Number(p.machine_id) === Number(maquinaAtual)
            );
        }
    }

    if (!paradasFiltradas.length) {
        paretoChart.innerHTML = '<div class="empty-message">Nenhuma parada registrada hoje para essa seleção.</div>';
        return;
    }

    // -----------------------------------------------------------
    // drill-down: motivo já selecionado — mostra paradas por hora
    // desse motivo em vez do Pareto normal
    // -----------------------------------------------------------

    if (motivoSelecionadoPareto != null) {
        renderizarParadasPorHoraDoMotivo(paradasFiltradas, motivoSelecionadoPareto);
        return;
    }

    // -----------------------------------------------------------
    // agrupa por motivo
    // -----------------------------------------------------------

    const porMotivo = {};
    paradasFiltradas.forEach(p => {
        const motivo = p.reason || "Não informado";
        if (!porMotivo[motivo]) porMotivo[motivo] = { ocorrencias: 0, minutos: 0 };
        porMotivo[motivo].ocorrencias++;
        porMotivo[motivo].minutos += minutosParado(p);
    });

    let itens = Object.entries(porMotivo)
        .map(([motivo, dados]) => ({ label: motivo, valor: dados.minutos, ocorrencias: dados.ocorrencias }))
        .sort((a, b) => b.valor - a.valor);

    // agrupa a cauda em "OUTROS" pra não poluir o gráfico — "OUTROS" é
    // uma soma de vários motivos diferentes, por isso fica marcado como
    // "agregado" e não é clicável (não existe uma única parada de
    // verdade com reason = "OUTROS" pra detalhar por hora)
    const LIMITE = 8;
    if (itens.length > LIMITE) {
        const principais = itens.slice(0, LIMITE - 1);
        const resto = itens.slice(LIMITE - 1);
        const outros = resto.reduce(
            (acc, i) => ({
                label: "OUTROS",
                valor: acc.valor + i.valor,
                ocorrencias: acc.ocorrencias + i.ocorrencias,
                agregado: true
            }),
            { label: "OUTROS", valor: 0, ocorrencias: 0, agregado: true }
        );
        itens = [...principais, outros];
    }

    const totalMinutos = itens.reduce((soma, i) => soma + i.valor, 0);

    let acumulado = 0;
    itens = itens.map(i => {
        acumulado += i.valor;
        return { ...i, percentualAcumulado: (acumulado / totalMinutos) * 100 };
    });

    paretoChart.innerHTML = construirSvgParetoGenerico(itens, formatarDuracao);

    // clique numa barra (que não seja "OUTROS") abre o detalhe por hora
    paretoChart.querySelectorAll(".pareto-barra-clicavel").forEach(el => {
        el.addEventListener("click", () => {
            motivoSelecionadoPareto = el.dataset.motivo;
            renderizarPareto();
        });
    });
}


// =====================================================================
// DRILL-DOWN: paradas de UM motivo, por hora do dia
// =====================================================================
//
// Cada parada é contada na hora em que COMEÇOU (started_at) — igual o
// resto do painel faz pra "produção por hora". Uma parada que atravessa
// a virada da hora não é fatiada entre as duas.
// =====================================================================

function renderizarParadasPorHoraDoMotivo(paradasFiltradas, motivo) {

    const doMotivo = paradasFiltradas.filter(p => (p.reason || "Não informado") === motivo);

    const porHora = {};
    doMotivo.forEach(p => {
        const hora = new Date(p.started_at).getHours();
        if (!porHora[hora]) porHora[hora] = { ocorrencias: 0, minutos: 0 };
        porHora[hora].ocorrencias++;
        porHora[hora].minutos += minutosParado(p);
    });

    const itensPorHora = Object.keys(porHora)
        .map(Number)
        .sort((a, b) => a - b)
        .map(hora => ({
            label: `${hora}h`,
            valor: porHora[hora].minutos,
            ocorrencias: porHora[hora].ocorrencias
        }));

    const totalMinutos = doMotivo.reduce((soma, p) => soma + minutosParado(p), 0);

    const cabecalho = `
        <div class="pareto-drilldown-header">
            <button type="button" class="btn pareto-voltar">&larr; Voltar</button>
            <div class="pareto-drilldown-titulo">
                <h4>${motivo}</h4>
                <p>${doMotivo.length} ocorrência${doMotivo.length === 1 ? "" : "s"} hoje · ${formatarDuracao(totalMinutos)} parado no total</p>
            </div>
        </div>
    `;

    const graficoHtml = itensPorHora.length
        ? construirSvgBarrasPorHora(itensPorHora, formatarDuracao)
        : '<div class="empty-message">Sem horário registrado pra essas paradas.</div>';

    paretoChart.innerHTML = cabecalho + graficoHtml;

    paretoChart.querySelector(".pareto-voltar").addEventListener("click", () => {
        motivoSelecionadoPareto = null;
        renderizarPareto();
    });
}


function construirSvgBarrasPorHora(itens, formatarValor) {

    const largura = 900;
    const altura = 300;
    const margemEsq = 55;
    const margemDir = 25;
    const margemTopo = 30;
    const margemBase = 40;

    const areaLargura = largura - margemEsq - margemDir;
    const areaAltura = altura - margemTopo - margemBase;

    const maiorValor = Math.max(...itens.map(i => i.valor));
    const larguraBarra = areaLargura / itens.length;

    const escalaY = valor => margemTopo + areaAltura - (valor / maiorValor) * areaAltura;

    const barras = itens.map((item, i) => {
        const x = margemEsq + i * larguraBarra + larguraBarra * 0.18;
        const w = larguraBarra * 0.64;
        const yTopo = escalaY(item.valor);
        const h = (margemTopo + areaAltura) - yTopo;
        const xCentro = x + w / 2;
        const yRotulo = margemTopo + areaAltura + 16;

        return `
            <rect x="${x}" y="${yTopo}" width="${w}" height="${h}"
                  fill="var(--status-stop)" rx="3"></rect>
            <text x="${xCentro}" y="${yTopo - 8}" text-anchor="middle"
                  class="pareto-valor-barra">${formatarValor(item.valor)}</text>
            <text x="${xCentro}" y="${yRotulo}" text-anchor="middle"
                  class="pareto-rotulo pareto-rotulo-hora">${item.label}</text>
        `;
    }).join("");

    return `
        <svg viewBox="0 0 ${largura} ${altura}" class="pareto-svg" preserveAspectRatio="xMidYMid meet">
            <line x1="${margemEsq}" y1="${margemTopo + areaAltura}" x2="${largura - margemDir}" y2="${margemTopo + areaAltura}"
                  stroke="var(--border)" stroke-width="1"></line>
            ${barras}
        </svg>
    `;
}


function construirSvgParetoGenerico(itens, formatarValor) {

    const largura = 900;
    const altura = 360;
    const margemEsq = 55;
    const margemDir = 55;
    const margemTopo = 20;
    const margemBase = 90;

    const areaLargura = largura - margemEsq - margemDir;
    const areaAltura = altura - margemTopo - margemBase;

    const maiorValor = Math.max(...itens.map(i => i.valor));
    const larguraBarra = areaLargura / itens.length;

    const escalaY = valor => margemTopo + areaAltura - (valor / maiorValor) * areaAltura;
    const escalaYPercentual = pct => margemTopo + areaAltura - (pct / 100) * areaAltura;

    // -----------------------------------------------------------
    // barras
    // -----------------------------------------------------------

    const barras = itens.map((item, i) => {
        const x = margemEsq + i * larguraBarra + larguraBarra * 0.15;
        const w = larguraBarra * 0.7;
        const yTopo = escalaY(item.valor);
        const h = (margemTopo + areaAltura) - yTopo;
        const critico = item.percentualAcumulado <= 80;
        const clicavel = !item.agregado;

        return `
            <rect x="${x}" y="${yTopo}" width="${w}" height="${h}"
                  fill="${critico ? "var(--status-stop)" : "var(--border-strong)"}"
                  rx="3"
                  class="pareto-barra${clicavel ? " pareto-barra-clicavel" : ""}"
                  ${clicavel ? `data-motivo="${escapeAtributoHtml(item.label)}"` : ""}
                  ><title>${clicavel ? "Clique para ver por hora" : "Agrupamento de vários motivos"}</title></rect>
            <text x="${x + w / 2}" y="${yTopo - 8}" text-anchor="middle"
                  class="pareto-valor-barra">${formatarValor(item.valor)}</text>
        `;
    }).join("");

    // -----------------------------------------------------------
    // rótulos do eixo X (rotacionados)
    // -----------------------------------------------------------

    const rotulos = itens.map((item, i) => {
        const x = margemEsq + i * larguraBarra + larguraBarra / 2;
        const y = margemTopo + areaAltura + 16;
        const label = item.label.length > 16 ? item.label.slice(0, 15) + "…" : item.label;
        return `
            <text x="${x}" y="${y}" text-anchor="end"
                  transform="rotate(-40 ${x} ${y})"
                  class="pareto-rotulo">${label}</text>
        `;
    }).join("");

    // -----------------------------------------------------------
    // linha acumulada (%) + pontos + linha de referência 80%
    // -----------------------------------------------------------

    const pontos = itens.map((item, i) => {
        const x = margemEsq + i * larguraBarra + larguraBarra / 2;
        const y = escalaYPercentual(item.percentualAcumulado);
        return { x, y, pct: item.percentualAcumulado };
    });

    const linhaPath = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

    const circulos = pontos.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--accent)"></circle>
    `).join("");

    const y80 = escalaYPercentual(80);

    return `
        <svg viewBox="0 0 ${largura} ${altura}" class="pareto-svg" preserveAspectRatio="xMidYMid meet">

            <line x1="${margemEsq}" y1="${y80}" x2="${largura - margemDir}" y2="${y80}"
                  stroke="var(--text-muted)" stroke-dasharray="4 4" stroke-width="1"></line>
            <text x="${largura - margemDir + 4}" y="${y80 + 4}" class="pareto-eixo-pct">80%</text>

            <line x1="${margemEsq}" y1="${margemTopo + areaAltura}" x2="${largura - margemDir}" y2="${margemTopo + areaAltura}"
                  stroke="var(--border)" stroke-width="1"></line>

            ${barras}
            ${rotulos}

            <path d="${linhaPath}" fill="none" stroke="var(--accent)" stroke-width="2"></path>
            ${circulos}

        </svg>

        <div class="pareto-legenda">
            <span><i class="pareto-swatch pareto-swatch-critico"></i> motivos até 80% acumulado (foco de ação)</span>
            <span><i class="pareto-swatch pareto-swatch-linha"></i> % acumulado</span>
        </div>
    `;
}


// =====================================================================
// FILTRO DE LINHA (Pareto)
// =====================================================================

// =====================================================================
// SELETORES DE LINHA / MÁQUINA (Pareto)
// =====================================================================

if (selectLinha) {
    selectLinha.addEventListener("change", () => {
        grupoAtual = selectLinha.value;
        motivoSelecionadoPareto = null; // volta pro Pareto normal ao trocar o filtro
        atualizarSeletorMaquina();
        renderizarPareto();
    });
}

if (selectMaquina) {
    selectMaquina.addEventListener("change", () => {
        maquinaAtual = selectMaquina.value;
        motivoSelecionadoPareto = null;
        renderizarPareto();
    });
}


// =====================================================================
// FILTRO DE STATUS
// =====================================================================

botoesFiltro.forEach(botao => {
    botao.addEventListener("click", () => {
        filtroAtual = botao.dataset.filtro;
        botoesFiltro.forEach(b => b.classList.remove("active"));
        botao.classList.add("active");
        renderizarMaquinas(ultimasMaquinas, ultimoMapaTempoParado, calcularProducaoPorMaquina("todos"), calcularRefugoPorMaquina("todos"), ultimosRegistrosHorariosPorMaquina, new Date());
    });
});


// =====================================================================
// REALTIME
// =====================================================================

supabaseClient
    .channel("supervisor-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: TABELAS.MACHINES }, () => carregar())
    .on("postgres_changes", { event: "*", schema: "public", table: TABELAS.STOPS }, () => carregar())
    .subscribe(status => { if (status === "SUBSCRIBED") setConexao("online"); });


// =====================================================================
// PRIMEIRA CARGA + FALLBACK
// =====================================================================

carregar();

setInterval(carregar, 15000);
