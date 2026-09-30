
// =====================================================================
// TELA: DASHBOARD DO GESTOR
// =====================================================================
//
// Acesso restrito a gestores.
// =====================================================================

exigirPapel(["gestor", "admin"]);

// O ../shared/supabaseClient.js já fornece:
// - supabaseClient
// - TABELAS
// - STATUS
// - classificarMaquina()
//
// NÃO declarar esses nomes novamente aqui.
// =====================================================================


// =====================================================================
// ELEMENTOS DA TELA
// =====================================================================

const listaAlertas = document.getElementById("lista-alertas");
const listaStatus = document.getElementById("lista-status");
const totalAlertas = document.getElementById("total-alertas");
const totalMaquinas = document.getElementById("total-maquinas");
const kpiRodando = document.getElementById("kpi-rodando");
const kpiParada = document.getElementById("kpi-parada");
const kpiSetup = document.getElementById("kpi-setup");
const kpiOee = document.getElementById("kpi-oee");
const kpiProduzido = document.getElementById("kpi-produzido");
const kpiTempoParado = document.getElementById("kpi-tempo-parado");
const kpiQtdParadas = document.getElementById("kpi-qtd-paradas");
const kpiMediaParada = document.getElementById("kpi-media-parada");
const lastUpdateEl = document.getElementById("last-update");
const connectionPill = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");


// =====================================================================
// STATUS DA CONEXÃO
// =====================================================================

function setConexao(estado) {

    if (!connectionPill || !connectionText) return;

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

function formatarHoraCurta(data) {
    return new Date(data).toLocaleTimeString(
        "pt-BR", { hour: "2-digit", minute: "2-digit" }
    );
}

// minutos parados até agora (paradas ainda abertas usam "agora" como fim)
function minutosParado(parada) {

    if (parada.duration_min != null) {
        return Number(parada.duration_min);
    }

    return (Date.now() - new Date(parada.started_at).getTime()) / 60000;
}

function formatarDuracao(minutos) {
    const m = Math.round(minutos);
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    const resto = m % 60;
    return `${h}h ${resto}min`;
}


// =====================================================================
// CARREGAR DASHBOARD
// =====================================================================

async function carregarDashboard() {

    try {

        setConexao("conectando");

        const { data: maquinas, error: erroMaquinas } = await supabaseClient
            .from(TABELAS.MACHINES)
            .select("*");

        if (erroMaquinas) {
            console.error("Erro ao buscar máquinas:", erroMaquinas);
            setConexao("erro");
            return;
        }

        // paradas ainda abertas — usadas só pra saber o "desde" certo
        // nos Alertas (machines.since não passa pela mesma conversão
        // de fuso que o resto do projeto, vem cru da TABCACHE; stops
        // já é reconciliada com cuidado via MOVIMENTACAO)
        const { data: paradasAbertas, error: erroParadasAbertas } = await supabaseClient
            .from(TABELAS.STOPS)
            .select("machine_id, started_at")
            .is("ended_at", null);

        if (erroParadasAbertas) {
            console.error("Erro ao buscar paradas abertas:", erroParadasAbertas);
        }

        const mapaParadaAbertaPorMaquina = {};
        (paradasAbertas || []).forEach(p => {
            const id = Number(p.machine_id);
            // se por algum motivo existir mais de uma aberta pra mesma
            // máquina, fica com a mais antiga (é a que está "valendo")
            if (!mapaParadaAbertaPorMaquina[id] || p.started_at < mapaParadaAbertaPorMaquina[id]) {
                mapaParadaAbertaPorMaquina[id] = p.started_at;
            }
        });

        const { data: stopReasonsData, error: erroMotivos } = await supabaseClient
            .from(TABELAS.STOP_REASONS)
            .select("*");

        if (erroMotivos) {
            console.error("Erro ao buscar stop_reasons:", erroMotivos);
        }

        const mapaMotivos = construirMapaMotivos(stopReasonsData || []);

        const listaMaquinas = Array.isArray(maquinas) ? maquinas : [];

        // =================================================================
        // TODAS AS PARADAS DE HOJE (abertas + já encerradas)
        // — usado pro KPI de tempo parado e pro ranking de motivos.
        // =================================================================

        const agora = new Date();
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

        const { data: paradasHoje, error: erroParadasHoje } = await supabaseClient
            .from(TABELAS.STOPS)
            .select("*")
            .gte("started_at", inicioHoje.toISOString());

        if (erroParadasHoje) {
            console.error("Erro ao buscar paradas do dia:", erroParadasHoje);
        }

        const listaParadasHoje = Array.isArray(paradasHoje) ? paradasHoje : [];

        // tempo parado hoje por máquina — precisa pro cálculo de OEE
        // (Disponibilidade) de cada uma.
        const mapaTempoParado = {};
        listaParadasHoje.forEach(p => {
            const id = Number(p.machine_id);
            mapaTempoParado[id] = (mapaTempoParado[id] || 0) + minutosParado(p);
        });

        // =================================================================
        // PRODUÇÃO/REFUGO/TEÓRICA + ÍNDICES BRUTOS (ID/IP/IQ/OEE) DE HOJE
        // — soma e agrupa producao_horaria por máquina (por faixa de
        // hora, robusta a troca de OP). O OEE agora é calculado pelo
        // próprio painel a partir desses índices brutos, com agenda
        // fixa por linha — ver shared/supabaseClient.js.
        // =================================================================

        const { data: producaoHoraria, error: erroProducao } = await supabaseClient
            .from(TABELAS.PRODUCAO_HORARIA)
            .select("machine_id, turno, qtde_produzida, qtde_rejeitada, qtde_teorica, indice_disponibilidade, indice_performance, indice_qualidade, oee_hora, hora")
            .gte("hora", inicioHoje.toISOString());

        if (erroProducao) {
            console.error("Erro ao buscar produção horária:", erroProducao);
        }

        const listaProducaoHoraria = producaoHoraria || [];

        const producaoPorMaquina = {};
        const refugoPorMaquina = {};
        const registrosHorariosPorMaquina = {};
        listaProducaoHoraria.forEach(registro => {
            const id = Number(registro.machine_id);
            producaoPorMaquina[id] = (producaoPorMaquina[id] || 0) + (Number(registro.qtde_produzida) || 0);
            refugoPorMaquina[id] = (refugoPorMaquina[id] || 0) + (Number(registro.qtde_rejeitada) || 0);
            if (!registrosHorariosPorMaquina[id]) registrosHorariosPorMaquina[id] = [];
            registrosHorariosPorMaquina[id].push(registro);
        });

        // =================================================================
        // CONTADORES DE STATUS + OEE MÉDIO
        // =================================================================
        //
        // "OEE MÉDIO" = média das 5 linhas (calcularOeePorLinha +
        // mediaDeLinhas, do shared/supabaseClient.js) — EXATAMENTE a
        // mesma conta do card "OEE GERAL DA FÁBRICA" no Supervisor.
        // =================================================================

        let rodando = 0, parada = 0, setup = 0;

        listaMaquinas.forEach(maquina => {
            const categoria = classificarMaquina(maquina);
            if (categoria === "rodando") rodando++;
            else if (categoria === "setup") setup++;
            else parada++;
        });

        if (kpiRodando) kpiRodando.textContent = rodando;
        if (kpiParada) kpiParada.textContent = parada;
        if (kpiSetup) kpiSetup.textContent = setup;
        if (totalMaquinas) totalMaquinas.textContent = `${listaMaquinas.length} máquinas`;

        if (kpiOee) {
            const { oeePorLinha } = calcularOeePorLinha(listaMaquinas, registrosHorariosPorMaquina, agora);
            const oeeMedio = mediaDeLinhas(oeePorLinha);

            kpiOee.textContent = oeeMedio != null
                ? Math.round(oeeMedio) + "%"
                : "—";
        }

        const idsDosadoras = new Set(
            listaMaquinas
                .filter(m => (m.line || "").toUpperCase().includes("DOSADORA"))
                .map(m => Number(m.id))
        );

        const produzidoHoje = Object.entries(producaoPorMaquina)
            .filter(([id]) => idsDosadoras.has(Number(id)))
            .reduce((soma, [, valor]) => soma + valor, 0);

        if (kpiProduzido) {
            kpiProduzido.textContent = produzidoHoje.toLocaleString("pt-BR");
        }

        // =================================================================
        // PARADA ACUMULADA (soma de todas as paradas do dia) + contagem
        // e duração média — informações discretas ao lado do total.
        //
        // Mesmo filtro do Pareto (Supervisor): tira "SEM EXPEDIENTE"/
        // "RECICLO"/"OS FINALIZADA" e qualquer parada fora do horário
        // real de turno da linha (o MOVIMENTACAO loga o período "antes
        // do turno começar" sob motivos com nome de problema real, tipo
        // FALTA ENERGIA — ver paradaDentroDoTurno em supabaseClient.js)
        // =================================================================

        const listaParadasHojeReais = listaParadasHoje.filter(p => {
            if (paradaEhAutomatica(p.reason, mapaMotivos)) return false;
            const numeroLinha = grupoDaLinha(p.line);
            return paradaDentroDoTurno(p, numeroLinha);
        });

        const totalMinutosParadoHoje = listaParadasHojeReais.reduce(
            (soma, p) => soma + minutosParado(p), 0
        );

        if (kpiTempoParado) {
            kpiTempoParado.textContent = formatarDuracao(totalMinutosParadoHoje);
        }

        if (kpiQtdParadas) {
            kpiQtdParadas.textContent = listaParadasHojeReais.length;
        }

        if (kpiMediaParada) {
            const media = listaParadasHojeReais.length > 0
                ? totalMinutosParadoHoje / listaParadasHojeReais.length
                : 0;
            kpiMediaParada.textContent = formatarDuracao(media);
        }

        // =================================================================
        // RENDERIZAR
        // =================================================================

        renderizarAlertas(listaMaquinas, mapaParadaAbertaPorMaquina);
        renderizarStatus(listaMaquinas);

        if (lastUpdateEl) {
            lastUpdateEl.textContent = formatarHoraCurta(new Date());
        }

        setConexao("online");

    } catch (erro) {
        console.error("Erro geral no dashboard:", erro);
        setConexao("erro");
    }
}


// =====================================================================
// ALERTAS — paradas em aberto, com duração e severidade visual
// =====================================================================

// =====================================================================
// ALERTAS — status/motivo ao vivo vêm de machines (mesma fonte que os
// cards já usam), mas o "desde" vem preferencialmente de stops (já
// reconciliada com cuidado via MOVIMENTACAO) — machines.since é o
// campo cru da TABCACHE, gravado sem passar pela mesma conversão de
// fuso horário do resto do projeto, e pode ficar preso em dado velho
// quando o EGA para de atualizar aquela linha (confirmado 2026-09).
// =====================================================================

function renderizarAlertas(maquinas, mapaParadaAbertaPorMaquina) {

    if (!listaAlertas) return;

    // prefere o started_at de stops pra essa máquina; só cai pro
    // since cru da TABCACHE se não houver parada aberta reconciliada
    function desdeDaMaquina(maquina) {
        const doStops = mapaParadaAbertaPorMaquina && mapaParadaAbertaPorMaquina[Number(maquina.id)];
        return doStops || maquina.since || null;
    }

    const emAberto = maquinas.filter(maquina => {

        if (classificarMaquina(maquina) === "rodando") return false;

        // exclui pelo TEXTO do motivo (SEM EXPEDIENTE/RECICLO/OS
        // FINALIZADA/EGA INOPERANTE)
        if (paradaEhAutomatica(maquina.reason)) return false;

        // sanidade: mesmo com o "desde" melhor (de stops), mantém um
        // limite absoluto — nada nessa fábrica dura mais de 24h
        // contínuas de verdade; se passar disso é dado velho de algum
        // jeito, não uma parada de hoje.
        const desde = desdeDaMaquina(maquina);
        if (desde) {
            const minutosDesde = (Date.now() - new Date(desde).getTime()) / 60000;
            if (minutosDesde > 24 * 60) return false;
        }

        return true;
    });

    if (totalAlertas) totalAlertas.textContent = emAberto.length;

    if (!emAberto.length) {
        listaAlertas.innerHTML = '<div class="empty-message">Nenhuma parada em aberto 🎉</div>';
        return;
    }

    const ordenados = [...emAberto].sort(
        (a, b) => new Date(desdeDaMaquina(a) || 0).getTime() - new Date(desdeDaMaquina(b) || 0).getTime()
    );

    listaAlertas.innerHTML = ordenados.map(maquina => {

        const nomeMaquina = maquina.line || `Máquina ${maquina.id}`;
        const motivo = maquina.reason || "PARADA A DEFINIR";
        const motivoIndefinido = ["MOT.INDETERMINADO", "PARADA A DEFINIR"].includes(motivo.toUpperCase());

        const desde = desdeDaMaquina(maquina);
        const minutos = desde
            ? (Date.now() - new Date(desde).getTime()) / 60000
            : 0;
        const critica = minutos >= 60;

        return `
            <div class="alert-item ${critica ? "alert-critico" : ""}">
                <div class="alert-main">
                    <strong>${nomeMaquina}</strong>
                    <span class="${motivoIndefinido ? "alert-blink" : ""}">${motivo}</span>
                </div>
                <div class="alert-time">
                    <span class="alert-duracao">${formatarDuracao(minutos)}</span>
                    <span class="alert-desde">desde ${desde ? formatarHoraCurta(desde) : "—"}</span>
                </div>
            </div>
        `;
    }).join("");
}


// =====================================================================
// STATUS DAS MÁQUINAS — um card por máquina
// =====================================================================

function renderizarStatus(maquinas) {

    if (!listaStatus) return;

    if (!maquinas.length) {
        listaStatus.innerHTML = '<div class="empty-message">Nenhuma máquina encontrada</div>';
        return;
    }

    const ordenadas = [...maquinas].sort((a, b) => Number(a.id) - Number(b.id));

    listaStatus.innerHTML = ordenadas.map(maquina => {

        const categoria = classificarMaquina(maquina);
        const textoStatus =
            categoria === "rodando" ? "RODANDO" :
            categoria === "setup" ? "SETUP" : "PARADA";

        const nome = maquina.line || `Máquina ${maquina.id}`;
        const operador = maquina.operator || "SEM OPERADOR";

        const produzido = Number(maquina.produced) || 0;
        const target = Number(maquina.target) || 0;
        const pct = target > 0 ? Math.min(100, Math.round((produzido / target) * 100)) : 0;

        const motivoHtml =
            categoria !== "rodando" && maquina.reason
                ? `<div class="dash-card-motivo">${maquina.reason}</div>`
                : "";

        return `
            <a class="dash-machine-card ${categoria}" href="../maquinas/minha_maquina.html?id=${maquina.id}">
                <div class="dash-card-topo">
                    <strong>${nome}</strong>
                    <div class="machine-state ${categoria}">
                        <span class="status-dot"></span>
                        ${textoStatus}
                    </div>
                </div>
                <span class="dash-card-operador">${operador}</span>
                <div class="dash-card-producao">
                    <div class="mini-progress-bg">
                        <div class="mini-progress-fill" style="width:${pct}%"></div>
                    </div>
                    <span>${produzido} / ${target} (${pct}%)</span>
                </div>
                ${motivoHtml}
            </a>
        `;
    }).join("");
}


// =====================================================================
// REALTIME
// =====================================================================

supabaseClient
    .channel("dashboard-machines")
    .on("postgres_changes", { event: "*", schema: "public", table: TABELAS.MACHINES }, () => carregarDashboard())
    .subscribe(status => { if (status === "SUBSCRIBED") setConexao("online"); });

supabaseClient
    .channel("dashboard-stops")
    .on("postgres_changes", { event: "*", schema: "public", table: TABELAS.STOPS }, () => carregarDashboard())
    .subscribe(status => { if (status === "SUBSCRIBED") setConexao("online"); });


// =====================================================================
// PRIMEIRA CARGA + ATUALIZAÇÃO PERIÓDICA
// =====================================================================

carregarDashboard();

setInterval(carregarDashboard, 15000);
