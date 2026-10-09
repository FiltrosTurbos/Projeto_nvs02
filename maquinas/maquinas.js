
// =====================================================================
// TELA: MÁQUINAS — status ao vivo
// =====================================================================
//
// Acesso liberado pra operador e gestor.
// =====================================================================

exigirPapel(["operador", "gestor", "pcp", "admin"]);

// O arquivo ../shared/supabaseClient.js já fornece:
// - supabaseClient
// - TABELAS
// - STATUS
// - classificarMaquina()
//
// NÃO declarar esses itens novamente aqui.
// =====================================================================


// =====================================================================
// ELEMENTOS DA TELA
// =====================================================================

const grid =
    document.getElementById("machines-grid");

const kpiRodando =
    document.getElementById("kpi-rodando");

const kpiParada =
    document.getElementById("kpi-parada");

const kpiSetup =
    document.getElementById("kpi-setup");

const lastUpdateEl =
    document.getElementById("last-update");

const connectionPill =
    document.getElementById("connection-status");

const connectionText =
    document.getElementById("connection-text");


// =====================================================================
// STATUS DA CONEXÃO
// =====================================================================

function setConexao(estado) {

    connectionPill.classList.remove(
        "online",
        "erro"
    );


    if (estado === "online") {

        connectionPill.classList.add("online");

        connectionText.textContent =
            "ao vivo";

    }

    else if (estado === "erro") {

        connectionPill.classList.add("erro");

        connectionText.textContent =
            "erro de conexão";

    }

    else {

        connectionText.textContent =
            "conectando...";
    }
}


// =====================================================================
// FORMATAR HORA
// =====================================================================

function formatarHora(data) {

    return new Date(data).toLocaleTimeString(
        "pt-BR",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );
}


// =====================================================================
// RENDERIZAR MÁQUINAS
// =====================================================================

function renderizarMaquinas(maquinas, mapaTempoParado = {}, producaoPorMaquina = {}, refugoPorMaquina = {}, registrosHorariosPorMaquina = {}, agora = new Date()) {

    if (
        !maquinas ||
        maquinas.length === 0
    ) {

        grid.innerHTML = `
            <div class="empty-message">
                Nenhuma máquina encontrada.
            </div>
        `;


        kpiRodando.textContent = "0";
        kpiParada.textContent = "0";
        kpiSetup.textContent = "0";

        return;
    }


    // ================================================================
    // ORDENAR POR ID
    // ================================================================

    const ordenadas =
        [...maquinas].sort(
            (a, b) =>
                Number(a.id) -
                Number(b.id)
        );


    // ================================================================
    // CONTADORES
    // ================================================================

    let totalRodando = 0;
    let totalParada = 0;
    let totalSetup = 0;


    // ================================================================
    // CRIAR CARDS
    // ================================================================

    const cards =
        ordenadas.map(maquina => {

            // OEE calculado pelo próprio painel (calcularOeeMaquinaV2,
            // shared/supabaseClient.js) — mesma fonte usada no
            // Supervisor e no Gestor, pra nunca mostrar números
            // diferentes pra mesma coisa.
            const { valor: oeeCalculado } = calcularOeeMaquinaV2(maquina, registrosHorariosPorMaquina, agora);


            // ========================================================
            // CLASSIFICAÇÃO CENTRALIZADA
            // ========================================================
            //
            // Essa função vem do supabaseClient.js.
            //
            // run
            //   -> rodando
            //
            // stop + SETUP
            //   -> setup
            //
            // stop
            //   -> parada
            // ========================================================

            const classe =
                classificarMaquina(
                    maquina
                );


            if (classe === "rodando") {

                totalRodando++;

            }

            else if (classe === "setup") {

                totalSetup++;

            }

            else {

                totalParada++;
            }


            // ========================================================
            // TEXTO DO STATUS
            // ========================================================

            const label =
                classe === "rodando"
                    ? "RODANDO"
                    : classe === "setup"
                        ? "SETUP"
                        : "PARADA";


            // ========================================================
            // PRODUÇÃO / META
            // ========================================================

            const produzido =
                Number(maquina.produced) || 0;

            const target =
                Number(maquina.target) || 0;


            const progresso =
                target > 0
                    ? Math.min(
                        100,
                        Math.round(
                            (produzido / target) *
                            100
                        )
                    )
                    : 0;


            // ========================================================
            // MOTIVO DA PARADA
            // ========================================================

            const motivo =
                maquina.reason || "";


            const motivoHtml =
                classe !== "rodando" &&
                motivo &&
                motivo !== "-"
                    ? `
                        <div class="motivo">
                            ${motivo}
                        </div>
                    `
                    : "";


            // ========================================================
            // CARD
            // ========================================================

            return `
                <a
                    class="machine-card ${classe}"
                    href="../maquinas/minha_maquina.html?id=${maquina.id}"
                >

                    <div class="linha">
                        ${maquina.line || "—"}
                    </div>


                    <span class="badge ${classe}">
                        ${label}
                    </span>


                    <div class="linha-info">

                        <span>
                            Operador
                        </span>

                        <strong>
                            ${maquina.operator || "—"}
                        </strong>

                    </div>


                    <div class="linha-info">

                        <span>
                            OP
                        </span>

                        <strong>
                            ${maquina.op || "—"}
                        </strong>

                    </div>


                    <div class="linha-info">

                        <span>
                            Produzido / Meta
                        </span>

                        <strong>
                            ${produzido}
                            /
                            ${target}
                            (${progresso}%)
                        </strong>

                    </div>


                    <div class="linha-info">

                        <span>
                            OEE
                        </span>

                        <strong>
                            ${
                                oeeCalculado != null
                                    ? oeeCalculado.toFixed(1) + "%"
                                    : "—"
                            }
                        </strong>

                    </div>


                    ${motivoHtml}

                </a>
            `;
        });


    // ================================================================
    // COLOCAR CARDS NA TELA
    // ================================================================

    grid.innerHTML =
        cards.join("");


    // ================================================================
    // ATUALIZAR KPIs
    // ================================================================

    kpiRodando.textContent =
        totalRodando;

    kpiParada.textContent =
        totalParada;

    kpiSetup.textContent =
        totalSetup;
}


// =====================================================================
// BUSCAR MÁQUINAS
// =====================================================================

function minutosParado(parada) {
    if (parada.duration_min != null) return Number(parada.duration_min);
    return (Date.now() - new Date(parada.started_at).getTime()) / 60000;
}

async function buscarMaquinas() {

    try {

        setConexao("conectando");


        const {
            data,
            error
        } = await supabaseClient
            .from(TABELAS.MACHINES)
            .select("*");


        // =============================================================
        // ERRO
        // =============================================================

        if (error) {

            console.error(
                "Erro ao buscar máquinas:",
                error
            );

            setConexao("erro");

            return;
        }


        // =============================================================
        // PARADAS E PRODUÇÃO DE HOJE
        // =============================================================

        const agora = new Date();
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

        const { data: paradasHoje, error: erroParadas } = await supabaseClient
            .from(TABELAS.STOPS)
            .select("machine_id, duration_min, started_at")
            .gte("started_at", inicioHoje.toISOString());

        if (erroParadas) {
            console.error("Erro ao buscar paradas do dia:", erroParadas);
        }

        const mapaTempoParado = {};
        (paradasHoje || []).forEach(p => {
            const id = Number(p.machine_id);
            mapaTempoParado[id] = (mapaTempoParado[id] || 0) + minutosParado(p);
        });

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


        // =============================================================
        // RENDERIZAR
        // =============================================================

        renderizarMaquinas(
            data || [],
            mapaTempoParado,
            producaoPorMaquina,
            refugoPorMaquina,
            registrosHorariosPorMaquina,
            agora
        );


        // =============================================================
        // HORÁRIO
        // =============================================================

        if (lastUpdateEl) {

            lastUpdateEl.textContent =
                formatarHora(
                    new Date()
                );
        }


        setConexao("online");

    }

    catch (erro) {

        console.error(
            "Erro geral ao carregar máquinas:",
            erro
        );

        setConexao("erro");
    }
}


// =====================================================================
// REALTIME
// =====================================================================
//
// Qualquer:
// INSERT
// UPDATE
// DELETE
//
// na tabela machines atualiza a tela.
// =====================================================================

function iniciarRealtime() {

    supabaseClient
        .channel("machines-changes")

        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: TABELAS.MACHINES
            },

            () => {

                buscarMaquinas();
            }
        )

        .subscribe(status => {

            console.log(
                "Realtime machines:",
                status
            );


            if (
                status === "SUBSCRIBED"
            ) {

                setConexao("online");
            }

        });
}


// =====================================================================
// INICIALIZAÇÃO
// =====================================================================

buscarMaquinas();

iniciarRealtime();


// =====================================================================
// FALLBACK
// =====================================================================
//
// Mesmo se o Realtime falhar, a tela continua sendo atualizada
// automaticamente a cada 15 segundos.
// =====================================================================

setInterval(
    buscarMaquinas,
    15000
);

