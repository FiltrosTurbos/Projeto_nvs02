
// =====================================================================
// TELA: DETALHE DA MÁQUINA (?id=)
// =====================================================================
//
// Acesso liberado pra operador e gestor.
// =====================================================================

exigirPapel(["operador", "gestor", "pcp", "admin"]);

// O ../shared/supabaseClient.js já fornece:
// - supabaseClient
// - TABELAS
// - STATUS
// - classificarMaquina()
//
// NÃO declarar esses nomes novamente aqui.
// =====================================================================

const params = new URLSearchParams(window.location.search);
const machineId = Number(params.get("id"));
const conteudo = document.getElementById("conteudo");


function formatarHora(data) {
    if (!data) return "—";
    return new Date(data).toLocaleString(
        "pt-BR",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    );
}

function formatarHoraCurta(data) {
    if (!data) return "—";
    return new Date(data).toLocaleTimeString(
        "pt-BR", { hour: "2-digit", minute: "2-digit" }
    );
}

function formatarDuracao(minutos) {
    if (minutos == null) return "em andamento";
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// minutos parados até agora (paradas ainda abertas usam "agora" como fim) —
// usado só pra ordenar as paradas por relevância, não pra exibir.
function minutosParado(parada) {
    if (parada.duration_min != null) return Number(parada.duration_min);
    return (Date.now() - new Date(parada.started_at).getTime()) / 60000;
}


// =====================================================================
// ALARME — tela vermelha + som quando a parada está com motivo NÃO
// INFORMADO (o operador ainda não classificou o motivo real no EGA).
// Mesmos 2 motivos já tratados como "indefinido" no gestor.js.
// =====================================================================

const MOTIVOS_INDEFINIDOS = ["MOT.INDETERMINADO", "PARADA A DEFINIR"];

function motivoIndefinido(maquina, classe) {
    if (classe === "rodando") return false;
    const motivo = (maquina.reason || "PARADA A DEFINIR").toUpperCase();
    return MOTIVOS_INDEFINIDOS.includes(motivo);
}

let audioCtx = null;
let sirenAtiva = false;
let sirenCarrier = null;
let sirenGain = null;
let sirenTimeoutId = null;
let sirenToneIndex = 0;

// Sirene de dois tons alternando rápido ("tá-tá-tá-tá"), em rajadas
// curtas com uma pequena pausa entre elas — igual ao padrão de
// referência (dois tons por volta de 700Hz/950Hz, trocando a cada
// ~180ms, rajada de ~1.4s com ~0.3s de silêncio entre rajadas).
const SIRENE_TOM_ALTO = 950;
const SIRENE_TOM_BAIXO = 700;
const SIRENE_DURACAO_TOM = 0.18;     // segundos que cada tom fica tocando
const SIRENE_TONS_POR_RAJADA = 8;    // ~1.4s de alternância antes da pausa
const SIRENE_PAUSA = 0.3;            // segundos de silêncio entre rajadas
const SIRENE_VOLUME = 0.14;

function agendarProximoTomDaSirene() {

    if (!sirenAtiva || !sirenCarrier || !audioCtx) return;

    // fim de uma rajada: silencia rapidinho, espera a pausa e recomeça
    if (sirenToneIndex > 0 && sirenToneIndex % SIRENE_TONS_POR_RAJADA === 0) {

        sirenGain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.02);

        sirenTimeoutId = setTimeout(() => {
            if (!sirenAtiva || !sirenGain) return;
            sirenGain.gain.setTargetAtTime(SIRENE_VOLUME, audioCtx.currentTime, 0.02);
            agendarProximoTomDaSirene();
        }, SIRENE_PAUSA * 1000);

        sirenToneIndex++;
        return;
    }

    const tom = sirenToneIndex % 2 === 0 ? SIRENE_TOM_ALTO : SIRENE_TOM_BAIXO;
    sirenCarrier.frequency.setValueAtTime(tom, audioCtx.currentTime);

    sirenToneIndex++;
    sirenTimeoutId = setTimeout(agendarProximoTomDaSirene, SIRENE_DURACAO_TOM * 1000);
}

function iniciarAlarmeSonoro() {

    if (sirenAtiva) return; // já está tocando, não duplica

    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }

        const carrier = audioCtx.createOscillator();
        carrier.type = "square"; // tom mais "clássico" de sirene eletrônica
        carrier.frequency.value = SIRENE_TOM_ALTO;

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(SIRENE_VOLUME, audioCtx.currentTime + 0.08);

        carrier.connect(gain);
        gain.connect(audioCtx.destination);
        carrier.start();

        sirenCarrier = carrier;
        sirenGain = gain;
        sirenAtiva = true;
        sirenToneIndex = 0;

        agendarProximoTomDaSirene();

    } catch (erro) {
        console.error("Não deu pra iniciar o alarme sonoro:", erro);
    }
}

function pararAlarmeSonoro() {

    if (!sirenAtiva) return;

    sirenAtiva = false;

    if (sirenTimeoutId) {
        clearTimeout(sirenTimeoutId);
        sirenTimeoutId = null;
    }

    try {
        if (sirenCarrier && sirenGain && audioCtx) {
            const agora = audioCtx.currentTime;

            // fade-out curto pra não cortar o som seco
            sirenGain.gain.cancelScheduledValues(agora);
            sirenGain.gain.setValueAtTime(Math.max(sirenGain.gain.value, 0.0001), agora);
            sirenGain.gain.exponentialRampToValueAtTime(0.0001, agora + 0.12);

            sirenCarrier.stop(agora + 0.15);
        }
    } catch (erro) {
        console.error("Erro ao parar o alarme sonoro:", erro);
    }

    sirenCarrier = null;
    sirenGain = null;
}

// navegadores bloqueiam áudio até o usuário interagir com a página pelo
// menos uma vez — qualquer toque na tela já "destrava" o alarme sonoro
// pro resto da sessão
document.addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
});
document.addEventListener("touchstart", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
});


async function carregar() {

    if (!machineId) {
        conteudo.innerHTML = '<div class="empty-message">Máquina não informada na URL (?id=).</div>';
        return;
    }

    const { data: maquina, error: erroMaquina } = await supabaseClient
        .from(TABELAS.MACHINES)
        .select("*")
        .eq("id", machineId)
        .single();

    if (erroMaquina || !maquina) {
        conteudo.innerHTML = '<div class="empty-message">Máquina não encontrada.</div>';
        console.error(erroMaquina);
        return;
    }

    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);

    const { data: paradasHoje, error: erroParadas } = await supabaseClient
        .from(TABELAS.STOPS)
        .select("*")
        .eq("machine_id", machineId)
        .gte("started_at", inicioHoje.toISOString())
        .order("started_at", { ascending: false });

    if (erroParadas) {
        console.error(erroParadas);
    }

    const { data: producaoHoraria, error: erroProducao } = await supabaseClient
        .from(TABELAS.PRODUCAO_HORARIA)
        .select("hora, turno, qtde_produzida, qtde_teorica, indice_disponibilidade, indice_performance, indice_qualidade, oee_hora")
        .eq("machine_id", machineId)
        .gte("hora", inicioHoje.toISOString())
        .order("hora", { ascending: true });

    if (erroProducao) {
        console.error(erroProducao);
    }

    // sequência salva pelo Sequenciador (PCP) — filtrada pela linha +
    // etapa (Plissadeira/Dosadora) dessa máquina específica — só a
    // sequência de HOJE (a tabela pode ter dias futuros já publicados
    // pelo PCP com antecedência)
    const numeroLinhaMaquina = grupoDaLinha(maquina.line);
    const etapaMaquina = etapaDaMaquina(maquina.line);

    const hojeTexto = `${inicioHoje.getFullYear()}-${String(inicioHoje.getMonth() + 1).padStart(2, "0")}-${String(inicioHoje.getDate()).padStart(2, "0")}`;

    let sequenciaSalva = [];
    if (numeroLinhaMaquina && etapaMaquina) {

        const { data: sequencia, error: erroSequencia } = await supabaseClient
            .from(TABELAS.SEQUENCIA_PRODUCAO)
            .select("*")
            .eq("numero_linha", numeroLinhaMaquina)
            .eq("etapa", etapaMaquina)
            .eq("data", hojeTexto)
            .order("posicao", { ascending: true });

        if (erroSequencia) {
            console.error(erroSequencia);
        } else {
            sequenciaSalva = sequencia || [];
        }
    }

    const metasDiarias = await buscarMetasDiarias();
    const metaDaLinha = numeroLinhaMaquina ? (metasDiarias[numeroLinhaMaquina] || 0) : 0;

    renderizar(maquina, paradasHoje || [], producaoHoraria || [], sequenciaSalva, metaDaLinha);
    requestAnimationFrame(ajustarEscalaDaPagina);
}


// =====================================================================
// CARDS DE HORA — cor pela produção TEÓRICA daquela hora (qtde_teorica,
// calculada pelo próprio EGA — já reflete corretamente troca de item
// dentro da hora, porque não é uma meta fixa aplicada a toda hora, é o
// teórico específico de cada faixa de 1h). Fallback pra meta oficial do
// item atual (machines.meta_pecas_hora) só nas horas sem qtde_teorica
// sincronizada, e fallback final pro comparativo relativo (melhor hora
// do dia) se nem isso tiver disponível.
// =====================================================================

function classificarHora(valor, teorica, meta, maiorValor) {

    if (valor == null) return "sem-dado";

    const limiteBom = INDICES_CONFIG.producao.bom / 100;
    const limiteAtencao = INDICES_CONFIG.producao.atencao / 100;

    // preferência 1: produção teórica DAQUELA hora específica
    if (teorica != null && teorica > 0) {

        const pct = valor / teorica;

        if (pct >= limiteBom) return "bom";
        if (pct >= limiteAtencao) return "atencao";
        return "critico";
    }

    // preferência 2: meta oficial do item atual (aproximação pras horas
    // que ainda não têm qtde_teorica sincronizada)
    if (meta != null && meta > 0) {

        const pct = valor / meta;

        if (pct >= limiteBom) return "bom";
        if (pct >= limiteAtencao) return "atencao";
        return "critico";
    }

    // fallback: sem meta nem teórico, compara com a melhor hora do dia
    if (valor === 0 || maiorValor <= 0) return "sem-dado";

    const pct = valor / maiorValor;

    if (pct >= 0.7) return "bom";
    if (pct >= 0.4) return "atencao";
    return "critico";
}

function renderizarCardsHoras(producaoHoraria, meta) {

    if (!producaoHoraria.length) {
        return '<div class="empty-message">Sem produção registrada hoje ainda.</div>';
    }

    // corta só as pontas sem produção (antes do turno começar / depois
    // que já não tem mais dado) — mantém qualquer hora zerada que
    // esteja NO MEIO do turno, porque aí é uma parada de verdade, não
    // "máquina fora do ar".
    const indicesComProducao = producaoHoraria
        .map((r, i) => ({ i, valor: Number(r.qtde_produzida) || 0 }))
        .filter(item => item.valor > 0)
        .map(item => item.i);

    const horasDoTurno = indicesComProducao.length
        ? producaoHoraria.slice(
            indicesComProducao[0],
            indicesComProducao[indicesComProducao.length - 1] + 1
          )
        : [];

    if (!horasDoTurno.length) {
        return '<div class="empty-message">Sem produção registrada hoje ainda.</div>';
    }

    const maiorValor = Math.max(
        ...horasDoTurno.map(r => Number(r.qtde_produzida) || 0)
    );

    // se pelo menos uma hora do turno já tem qtde_teorica sincronizada,
    // essa é a base usada na legenda (mesmo que alguma hora isolada
    // ainda não tenha — aí ela cai no fallback da meta dentro de
    // classificarHora)
    const temTeorica = horasDoTurno.some(r => (Number(r.qtde_teorica) || 0) > 0);

    const legenda = temTeorica
        ? `<p class="horas-legenda">Comparado com a produção teórica de cada hora — já considera troca de item durante a hora, em vez de uma meta fixa. Verde ≥${INDICES_CONFIG.producao.bom}%, amarelo ≥${INDICES_CONFIG.producao.atencao}%, vermelho abaixo</p>`
        : meta != null && meta > 0
            ? `<p class="horas-legenda">Meta oficial: <strong>${meta.toLocaleString("pt-BR")} pçs/h</strong> — verde ≥${INDICES_CONFIG.producao.bom}% da meta, amarelo ≥${INDICES_CONFIG.producao.atencao}%, vermelho abaixo</p>`
            : `<p class="horas-legenda">Sem meta oficial de peças/hora sincronizada ainda — cor comparando com a melhor hora do dia</p>`;

    return `
        ${legenda}
        <div class="horas-grid">
            ${horasDoTurno.map(r => {

                const valor = Number(r.qtde_produzida) || 0;
                const teorica = Number(r.qtde_teorica) || 0;
                const horaLabel = new Date(r.hora).getHours();
                const faixa = classificarHora(valor, teorica, meta, maiorValor);

                return `
                    <div class="hora-card hora-${faixa}">
                        <span class="hora-numero">${horaLabel}h</span>
                        <span class="hora-valor">${valor.toLocaleString("pt-BR")}</span>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}


// =====================================================================
// RITMO — peças/min necessário pra bater a meta vs peças/min atual
// =====================================================================
//
// "Necessário": meta_pecas_hora (meta oficial, TABCACHE.PH_PADRAO) / 60.
// "Atual": pecas_hora (ritmo em tempo real, TABCACHE.PH_REAL) / 60 — já
// sincronizado, não precisa calcular nada a partir da produção por hora.
//
// Mesmos limiares de cor usados nos cards de "Produção por hora"
// (classificarHora): >=80% do necessário = bom, >=60% = atenção,
// abaixo = crítico. Sem meta oficial sincronizada, não dá pra avaliar.
// =====================================================================

function formatarPecasPorMin(valor) {
    if (valor == null) return "—";
    return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function classificarRitmo(atualPorMin, necessarioPorMin) {
    if (necessarioPorMin == null || necessarioPorMin <= 0) return "sem-dado";
    if (atualPorMin == null) return "sem-dado";

    const pct = atualPorMin / necessarioPorMin;
    if (pct >= INDICES_CONFIG.producao.bom / 100) return "bom";
    if (pct >= INDICES_CONFIG.producao.atencao / 100) return "atencao";
    return "critico";
}

function renderizarRitmo(maquina) {

    const meta = Number(maquina.meta_pecas_hora) || 0;
    const pecasHoraAtual = maquina.pecas_hora != null ? Number(maquina.pecas_hora) : null;

    const necessarioPorMin = meta > 0 ? meta / 60 : null;
    const atualPorMin = pecasHoraAtual != null ? pecasHoraAtual / 60 : null;

    const faixa = classificarRitmo(atualPorMin, necessarioPorMin);

    const subNecessario = meta > 0
        ? `pçs/min · meta ${meta.toLocaleString("pt-BR")} pçs/h`
        : "sem meta oficial sincronizada";

    const subAtual = pecasHoraAtual != null
        ? `pçs/min · ${pecasHoraAtual.toLocaleString("pt-BR")} pçs/h agora`
        : "sem leitura em tempo real ainda";

    return `
        <div class="panel ritmo-panel">
            <div class="panel-header">
                <div>
                    <h3>Ritmo — peças por minuto</h3>
                </div>
            </div>
            <div class="ritmo-grid">
                <div class="ritmo-box">
                    <span class="ritmo-label">PRECISA FAZER</span>
                    <span class="ritmo-valor">${formatarPecasPorMin(necessarioPorMin)}</span>
                    <span class="ritmo-sub">${subNecessario}</span>
                </div>
                <div class="ritmo-box ritmo-${faixa}">
                    <span class="ritmo-label">RITMO ATUAL</span>
                    <span class="ritmo-valor">${formatarPecasPorMin(atualPorMin)}</span>
                    <span class="ritmo-sub">${subAtual}</span>
                </div>
            </div>
        </div>
    `;
}


// =====================================================================
// SEQUÊNCIA DE PRODUÇÃO — janela de 3 OPs, sempre começando na que
// está rodando agora na máquina (comparando com machines.op ao vivo,
// não um instantâneo antigo salvo na hora que o PCP gerou) — assim que
// a máquina troca de OP (a atual foi produzida), a lista anda sozinha
// e mostra as 3 seguintes, sem precisar de nenhuma ação do operador.
// =====================================================================

// mesmo cuidado do Sequenciador: a planilha de OPs exporta com zeros à
// esquerda ("00130552"), o EGA manda sem ("130552") — sem isso a OP
// atual nunca seria encontrada na sequência salva
function normalizarOPSequencia(valor) {
    return String(valor ?? "").trim().replace(/^0+(?=\d)/, "");
}

function renderizarSequencia(sequenciaSalva, opAtualDaMaquina) {

    if (!sequenciaSalva || !sequenciaSalva.length) {
        return `
            <div class="panel sequencia-panel">
                <div class="panel-header">
                    <div><h3>Sequência de Produção</h3></div>
                </div>
                <div class="empty-message">Sequenciamento ainda não disponível pra essa linha hoje.</div>
            </div>
        `;
    }

    const opAtualNormalizado = normalizarOPSequencia(opAtualDaMaquina);

    let indiceAtual = sequenciaSalva.findIndex(
        item => normalizarOPSequencia(item.op) === opAtualNormalizado && opAtualNormalizado !== ""
    );

    // não achou a OP atual na sequência (pode não ter sido planejada,
    // ou já passou dela) — mostra a partir do começo mesmo
    if (indiceAtual === -1) indiceAtual = 0;

    const itensParaMostrar = sequenciaSalva.slice(indiceAtual, indiceAtual + 3);

    const linhasHtml = itensParaMostrar.map((item, i) => {

        const ehAAtual = i === 0 && indiceAtual < sequenciaSalva.length
            && normalizarOPSequencia(item.op) === opAtualNormalizado && opAtualNormalizado !== "";

        const anterior = i > 0 ? itensParaMostrar[i - 1] : null;
        const mudaCor = anterior && (item.cor || "") !== (anterior.cor || "");
        const mudaRolo = anterior && item.eixo !== anterior.eixo;

        const tagTroca = mudaCor
            ? `<span class="sequencia-tag-troca">🔄 troca de cor</span>`
            : mudaRolo
                ? `<span class="sequencia-tag-troca">🔄 troca de rolo</span>`
                : "";

        const tagManual = item.alterado_manualmente
            ? `<span class="sequencia-tag-manual">✋ ajuste manual</span>`
            : "";

        return `
            <div class="sequencia-item ${ehAAtual ? "sequencia-item-atual" : ""}">
                <span class="sequencia-pos">${indiceAtual + i + 1}</span>
                <div class="sequencia-info">
                    <span class="sequencia-op">${escaparHtmlSequencia(item.op)} ${ehAAtual ? '<span class="sequencia-tag-atual">EM MÁQUINA</span>' : ""}${tagTroca}${tagManual}</span>
                    <span class="sequencia-detalhe">${escaparHtmlSequencia(item.codigo_item)}</span>
                </div>
                <span class="sequencia-qtde">${(Number(item.qtde_item) || 0).toLocaleString("pt-BR")}</span>
            </div>
        `;
    }).join("");

    return `
        <div class="panel sequencia-panel">
            <div class="panel-header">
                <div><h3>Sequência de Produção</h3></div>
            </div>
            <div class="sequencia-lista">
                ${linhasHtml}
            </div>
        </div>
    `;
}

function escaparHtmlSequencia(texto) {
    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


function renderizar(maquina, paradasHoje, producaoHoraria, sequenciaSalva, metaDaLinha) {

    const classe = classificarMaquina(maquina);
    const label =
        classe === "rodando" ? "RODANDO" :
        classe === "setup" ? "SETUP" :
        "PARADA";

    // liga/desliga a tela vermelha + o alarme sonoro
    const emAlarme = motivoIndefinido(maquina, classe);
    document.body.classList.toggle("alarme-motivo-indefinido", emAlarme);
    if (emAlarme) {
        iniciarAlarmeSonoro();
    } else {
        pararAlarmeSonoro();
    }

    const produzido = Number(maquina.produced) || 0;
    const target = Number(maquina.target) || 0;
    const progresso = target > 0
        ? Math.min(100, Math.round((produzido / target) * 100))
        : 0;

    const alertaHtml =
        classe !== "rodando"
            ? `
                <div class="alert-box${emAlarme ? " alert-box-alarme" : ""}">
                    <div>
                        <div class="alert-title">${emAlarme ? "Motivo da parada não informado" : "Máquina parada"}</div>
                        <div class="alert-reason">${maquina.reason || "Motivo não informado"}</div>
                        <div class="alert-time">desde ${formatarHora(maquina.since)}</div>
                    </div>
                </div>
            `
            : "";

    // ---------------- Item em produção (código + descrição) ----------------
    //
    // maquina.item vem cru do EGA (NOME_PECA1) e às vezes traz um
    // prefixo tipo "(0) " (indicador de cavidade) que não interessa
    // pro operador — removido aqui.

    const descricaoItem = (maquina.item || "").replace(/^\(\d+\)\s*/, "").trim();

    const itemHtml = descricaoItem
        ? `<div class="op-item">${descricaoItem}</div>`
        : "";

    // ---------------- Paradas de hoje — top 5 por duração ----------------

    const top5Paradas = [...paradasHoje]
        .sort((a, b) => minutosParado(b) - minutosParado(a))
        .slice(0, 3);

    const listaParadas = top5Paradas.length === 0
        ? '<div class="empty-message">Nenhuma parada registrada hoje 🎉</div>'
        : top5Paradas.map(p => `
            <div class="parada-item">
                <span class="parada-nome">${p.reason || "Motivo não informado"}</span>
                <span class="parada-duracao">${formatarDuracao(minutosParado(p))}</span>
            </div>
        `).join("");

    // ---------------- OEE calculado pelo próprio painel (agenda fixa
    // por linha — ver shared/supabaseClient.js), igual o resto do app ----------------

    const agora = new Date();
    const registrosHorariosPorMaquina = { [Number(maquina.id)]: producaoHoraria };
    const { valor: oeeValor } = calcularOeeMaquinaV2(maquina, registrosHorariosPorMaquina, agora);

    function faixaOeeAtual(valor) {
        if (valor == null) return "sem-dado";
        if (valor < INDICES_CONFIG.oee.atencao) return "critico";
        if (valor < INDICES_CONFIG.oee.bom) return "atencao";
        return "bom";
    }

    const oeeBadgeHtml = `
        <span class="oee-badge-mini oee-${faixaOeeAtual(oeeValor)}" title="OEE calculado hoje">
            <span class="oee-badge-mini-label">OEE</span>
            <span class="oee-badge-mini-valor">${oeeValor != null ? oeeValor.toFixed(0) + "%" : "—"}</span>
        </span>
    `;

    conteudo.innerHTML = `
        <div class="machine-layout">

            <div class="machine-col-main">

                <div class="machine-header">
                    <div>
                        <h2>${maquina.line}</h2>
                        <span class="op-label">OP ATUAL</span>
                        <div class="op-numero">${maquina.op || "—"}</div>
                        ${itemHtml}
                    </div>
                    <div class="machine-header-status">
                        <span class="badge ${classe}">${label}</span>
                        ${oeeBadgeHtml}
                    </div>
                </div>

                ${alertaHtml}

                <div class="progress-section panel">
                    <div class="progress-labels">
                        <span>Produzido / Meta da OP</span>
                        <span class="progress-pct">${progresso}%</span>
                    </div>
                    <div class="progress-numeros">
                        <span class="progress-produzido">${produzido.toLocaleString("pt-BR")}</span>
                        <span class="progress-sep">/</span>
                        <span class="progress-meta">${target.toLocaleString("pt-BR")}</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-fill" style="width:${progresso}%"></div>
                    </div>
                </div>

                <div class="info-grid">
                    <div class="info-box">
                        <span class="info-label">OPERADOR</span>
                        <span class="info-value">${maquina.operator || "—"}</span>
                    </div>
                    <div class="info-box">
                        <span class="info-label">ÚLTIMA SINCRONIA</span>
                        <span class="info-value" style="font-size:15px">${formatarHora(maquina.last_sync)}</span>
                    </div>
                </div>

                <div class="panel horas-panel">
                    <div class="panel-header">
                        <div>
                            <h3>Produção por hora — hoje</h3>
                            <p>Verde = boa produção, amarelo = mediana, vermelho = baixa</p>
                        </div>
                    </div>
                    ${renderizarCardsHoras(producaoHoraria, maquina.meta_pecas_hora)}
                </div>

            </div>

            <div class="machine-col-paradas">
                ${renderizarSequencia(sequenciaSalva, maquina.op)}

                ${renderizarRitmo(maquina)}

                <div class="panel paradas-panel">
                    <div class="panel-header">
                        <div>
                            <h3>Top 3 paradas — hoje</h3>
                        </div>
                    </div>
                    <div class="paradas-lista">
                        ${listaParadas}
                    </div>
                </div>
            </div>

        </div>
    `;
}

// =====================================================================
// AJUSTE AUTOMÁTICO DE ESCALA — garante que a tela inteira caiba no
// espaço disponível SEM NENHUM scroll, nem da página, nem de nenhum
// painel — o operador não tem acesso garantido a mouse/teclado pra
// rolar nada. Mede a altura real do conteúdo já renderizado e, se não
// couber, encolhe TUDO proporcionalmente (texto, cards, espaçamento —
// a página inteira, não só um painel) até caber. Reajusta a cada
// atualização de dado (o conteúdo muda de tamanho o dia todo) e
// sempre que a janela/tela muda de tamanho.
// =====================================================================

function ajustarEscalaDaPagina() {

    if (!conteudo) return;

    // reseta antes de medir, senão mediria o tamanho já encolhido de
    // uma rodada anterior
    conteudo.style.zoom = "1";

    const topoConteudo = conteudo.getBoundingClientRect().top;
    const alturaDisponivel = window.innerHeight - topoConteudo - 12;
    const alturaReal = conteudo.scrollHeight;

    if (alturaReal > alturaDisponivel && alturaDisponivel > 0) {

        // nunca encolhe mais que 55% — depois disso fica ilegível, e
        // aí é melhor deixar rolar um pouquinho do que virar miniatura
        const fator = Math.max(0.55, alturaDisponivel / alturaReal);

        // zoom (não transform: scale) — encolhe o layout inteiro de
        // verdade, largura incluída, sem precisar compensar nada na
        // mão; transform: scale() só encolhe visualmente e deixava o
        // conteúdo largo demais, cortando a direita da tela
        conteudo.style.zoom = String(fator);
    }
}

window.addEventListener("resize", ajustarEscalaDaPagina);

carregarIndicesConfig().then(carregar);

// desliga o alarme se o operador sair dessa tela (evita som tocando em
// segundo plano depois de navegar pra outra página)
window.addEventListener("pagehide", pararAlarmeSonoro);

// realtime: qualquer mudança nesta máquina específica recarrega a tela
supabaseClient
    .channel(`machine-${machineId}-changes`)
    .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABELAS.MACHINES, filter: `id=eq.${machineId}` },
        carregar
    )
    .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABELAS.STOPS, filter: `machine_id=eq.${machineId}` },
        carregar
    )
    .subscribe();

setInterval(carregar, 20000);
