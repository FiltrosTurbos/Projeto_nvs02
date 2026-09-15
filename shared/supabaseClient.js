
// =====================================================================
// CONEXÃO ÚNICA COM O SUPABASE
// =====================================================================
//
// O SDK do Supabase já foi carregado pelo HTML:
//
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// Depois deste arquivo:
//
// <script src="../shared/supabaseClient.js"></script>
//
// IMPORTANTE:
// Não usamos o nome "supabase" para o cliente,
// porque o próprio SDK já utiliza window.supabase.
// =====================================================================


// =====================================================================
// CONFIGURAÇÃO
// =====================================================================

const SUPABASE_URL =
    "https://unbqqiztwjiskvavleak.supabase.co";

// Chave "publishable" — segura pra ficar exposta no navegador. Só
// consegue LER (SELECT), porque o RLS das tabelas não tem nenhuma
// policy de escrita pra role "anon". Quem escreve é o sync.js, usando
// a chave "secret" (sync/.env) — essa nunca deve vir pra cá.
const SUPABASE_ANON_KEY =
    "sb_publishable_h9oN-o5kMvtXAxz-1AWMsA_qhh0iZDW";


// =====================================================================
// CLIENTE SUPABASE
// =====================================================================
//
// window.supabase = biblioteca do SDK
//
// supabaseClient = cliente conectado ao seu projeto
// =====================================================================

const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );


// =====================================================================
// NOMES DAS TABELAS
// =====================================================================

const TABELAS = {

    MACHINES:
        "machines",

    PRODUCTION_HISTORY:
        "production_history",

    STOPS:
        "stops",

    TURNOS_CONFIG:
        "turnos_config",

    STOP_REASONS:
        "stop_reasons",

    PRODUCAO_HORARIA:
        "producao_horaria"
};


// =====================================================================
// STATUS DO BANCO
// =====================================================================

const STATUS = {

    RUN:
        "run",

    STOP:
        "stop"
};


// =====================================================================
// CLASSIFICAÇÃO DA MÁQUINA
// =====================================================================
//
// Banco:
// run  -> Rodando
// stop -> Parada
//
// Exceção:
// stop + reason SETUP -> Setup
// =====================================================================

function classificarMaquina(maquina) {

    if (maquina.status === STATUS.RUN) {

        return "rodando";
    }


    if (
        maquina.status === STATUS.STOP &&
        (maquina.reason || "").toUpperCase() === "SETUP"
    ) {

        return "setup";
    }


    return "parada";
}


// =====================================================================
// CÁLCULO DO OEE — Disponibilidade × Performance × Qualidade
// =====================================================================
//
// Fonte única da verdade pro cálculo, igual classificarMaquina() acima.
// Se os 3 fatores não vierem do sync.js (nomes de coluna ainda não
// confirmados no SQL Server do EGA — ver SCHEMA_SUPABASE.md), cai de
// volta pro campo "oee" consolidado que o EGA já manda pronto.
//
// Os 3 fatores vêm em percentual (0–100), por isso a divisão por 10000
// (100 × 100 × 100 = 1.000.000; dividido por 100² dá o resultado em %).
// =====================================================================

function calcularOeeMaquina(maquina) {

    const { disponibilidade, performance, qualidade } = maquina;

    const temOsTresFatores =
        disponibilidade != null &&
        performance != null &&
        qualidade != null;

    if (temOsTresFatores) {

        const d = Number(disponibilidade);
        const p = Number(performance);
        const q = Number(qualidade);

        // O EGA pode gravar ID/IP/IQ como fração (0–1) ou já em
        // percentual (0–100) — não dá pra saber sem ver os dados reais.
        // Detecta automaticamente pela magnitude dos 3 valores.
        const pareceFracao = d <= 1.5 && p <= 1.5 && q <= 1.5;

        const calculado = pareceFracao
            ? d * p * q * 100
            : (d * p * q) / 10000;

        return {
            valor: calculado,
            origem: "calculado"
        };
    }

    return {
        valor: maquina.oee != null ? Number(maquina.oee) : null,
        origem: "consolidado"
    };
}


// =====================================================================
// OEE CALCULADO PELO PRÓPRIO PAINEL, COM AGENDA FIXA POR LINHA (2026-09)
// =====================================================================
//
// Não depende mais de machines.disponibilidade/performance/qualidade/
// oee sincronizados do EGA, nem de turnos_config/dbo.TURNOS pra saber
// o horário de turno. O EGA confirmou que o cálculo por hora é
// OEE = ID × IP × IQ / 10000 — sincronizamos esses 3 índices brutos
// por hora (producao_horaria.indice_disponibilidade/performance/
// qualidade), e o PRÓPRIO PAINEL decide quais horas do dia entram na
// conta, usando a agenda real de cada linha (não o que o EGA registrou
// ou deixou de registrar):
//
//   Linha 1: 05:30–22:30, todos os dias
//   Demais linhas: 07:00–17:00 (segunda a quinta), 07:00–16:00 (sexta)
//
// Hora de almoço não tem janela própria — já entra como parada real
// (motivo "REFEICAO") no tempo parado de cada máquina, refletida no
// próprio índice de Disponibilidade (ID) daquela hora.
//
// Hora dentro da agenda sem nenhum registro em OEE_HORARIO conta como
// 0% de Disponibilidade (validado com dado real: é assim que o
// relatório nativo do EGA trata hora programada sem produção).
//
//   Disponibilidade do dia = média simples do ID de cada hora da
//     agenda (incluindo horas sem registro, como 0%)
//   Performance/Qualidade do dia = IP/IQ de cada hora, ponderados pela
//     quantidade produzida daquela hora (hora sem produção tem peso
//     zero, não distorce a média)
//   OEE = Disponibilidade × Performance × Qualidade / 10000
// =====================================================================

// janela de horas (números inteiros, hora de início e hora de fim,
// ambos incluídos) que compõem o turno de cada linha hoje
function janelaDeHorasDaLinha(numeroLinha, data) {

    const ehSexta = data.getDay() === 5; // 0=domingo ... 5=sexta-feira

    if (numeroLinha === 1) {
        // 05:30–22:30 → cobre as faixas de hora 05h a 22h
        return { inicio: 5, fim: 22 };
    }

    // demais linhas: 07:00–17:00 (seg-qui) → faixas 07h a 16h
    // sexta: 07:00–16:00 → faixas 07h a 15h
    return ehSexta
        ? { inicio: 7, fim: 15 }
        : { inicio: 7, fim: 16 };
}

// lista de horas (0–23) da agenda da linha que já devem ter acontecido
// até agora — uma hora em andamento ainda entra na conta
function horasEsperadasDaLinha(numeroLinha, agora) {

    const { inicio, fim } = janelaDeHorasDaLinha(numeroLinha, agora);
    const fimEfetivo = Math.min(fim, agora.getHours());

    if (fimEfetivo < inicio) return [];

    const horas = [];
    for (let h = inicio; h <= fimEfetivo; h++) horas.push(h);
    return horas;
}

// consolida o OEE do dia de uma máquina a partir dos registros brutos
// por hora (producao_horaria) e da agenda fixa da linha dela
function calcularOeeDoDiaPorHoras(registrosHorarios, numeroLinha, agora) {

    const horasEsperadas = horasEsperadasDaLinha(numeroLinha, agora);
    if (!horasEsperadas.length) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null };
    }

    const porHora = {};
    (registrosHorarios || []).forEach(r => {
        porHora[new Date(r.hora).getHours()] = r;
    });

    let somaD = 0;
    let somaPPonderada = 0, somaQPonderada = 0, somaPeso = 0;

    horasEsperadas.forEach(h => {
        const r = porHora[h];

        const id = r && r.indice_disponibilidade != null ? Number(r.indice_disponibilidade) : 0;
        const ip = r && r.indice_performance != null ? Number(r.indice_performance) : 0;
        const iq = r && r.indice_qualidade != null ? Number(r.indice_qualidade) : 0;
        const produzida = r && r.qtde_produzida != null ? Number(r.qtde_produzida) : 0;

        somaD += id;

        if (produzida > 0) {
            somaPPonderada += ip * produzida;
            somaQPonderada += iq * produzida;
            somaPeso += produzida;
        }
    });

    const disponibilidade = somaD / horasEsperadas.length;
    const performance = somaPeso > 0 ? somaPPonderada / somaPeso : null;
    const qualidade = somaPeso > 0 ? somaQPonderada / somaPeso : 100;

    const oee = performance != null
        ? (disponibilidade * performance * qualidade) / 10000
        : null;

    return { disponibilidade, performance, qualidade, oee };
}

// wrapper por máquina — "registrosHorariosPorMaquina" é um mapa
// { machine_id: [linhas de producao_horaria de hoje] }
function calcularOeeMaquinaV2(maquina, registrosHorariosPorMaquina, agora) {

    const numeroLinha = grupoDaLinha(maquina.line);
    if (!numeroLinha) {
        return { valor: null, disponibilidade: null, performance: null, qualidade: null, origem: "sem_linha" };
    }

    const id = Number(maquina.id);
    const registros = (registrosHorariosPorMaquina || {})[id] || [];

    const resultado = calcularOeeDoDiaPorHoras(registros, numeroLinha, agora || new Date());

    return {
        valor: resultado.oee,
        disponibilidade: resultado.disponibilidade,
        performance: resultado.performance,
        qualidade: resultado.qualidade,
        origem: "calculado_agenda_fixa"
    };
}


// =====================================================================
// AGRUPAMENTO POR LINHA + OEE CONSOLIDADO DA LINHA
// =====================================================================
//
// Fonte única pras 3 telas que mostram "OEE por linha"/"OEE médio"
// (Supervisor, Gestor) — todas chamam essas mesmas funções, pra nunca
// mostrar números diferentes pra mesma coisa. O agrupamento é lido do
// próprio nome da máquina (ex.: "DOSADORA L4 BAIXA" e "DOSADORA L4
// MÉDIA" caem as duas na Linha 4), sem depender de lista de IDs manual.
//
// OEE da linha = média simples do OEE (calcularOeeMaquinaV2, calculado
// pelo próprio painel — ver bloco acima) de cada máquina da linha.
// =====================================================================

function grupoDaLinha(nomeLinha) {
    const m = (nomeLinha || "").match(/L(\d)/i);
    return m ? Number(m[1]) : null;
}

function calcularOeePorLinha(maquinas, registrosHorariosPorMaquina, agora) {

    const grupos = {};

    maquinas.forEach(m => {
        const grupo = grupoDaLinha(m.line);
        if (!grupo) return;

        const { valor: oee, disponibilidade, performance, qualidade } = calcularOeeMaquinaV2(m, registrosHorariosPorMaquina, agora);
        if (oee == null || isNaN(oee)) return;

        if (!grupos[grupo]) grupos[grupo] = [];
        grupos[grupo].push({ nome: m.line, oee, d: disponibilidade, p: performance, q: qualidade });
    });

    const oeePorLinha = {};
    Object.keys(grupos).forEach(n => {
        const valores = grupos[n].map(i => i.oee).filter(v => v != null && !isNaN(v));
        oeePorLinha[n] = valores.length
            ? valores.reduce((s, v) => s + v, 0) / valores.length
            : null;
    });

    return { grupos, oeePorLinha };
}

// média simples dos valores de OEE por linha (ignora linhas sem dado
// ainda) — usada por todos os cards de "OEE geral"/"OEE médio" da
// aplicação, pra garantir que sempre mostrem o mesmo número
function mediaDeLinhas(oeePorLinha) {
    const valores = Object.values(oeePorLinha).filter(v => v != null && !isNaN(v));
    return valores.length
        ? valores.reduce((soma, v) => soma + v, 0) / valores.length
        : null;
}


// =====================================================================
// OEE CALCULADO DO ZERO — Disponibilidade × Performance × Qualidade
// =====================================================================
//
// Diferente de calcularOeeMaquina() acima (que usa o OEE já pronto que
// o EGA calcula internamente em OEE_HORARIO — e que a gente nunca
// conseguiu bater 100% com os relatórios oficiais do EGA depois de
// várias tentativas), esta função calcula o OEE do ZERO, a partir de
// dados brutos que a gente já sincroniza (parada, produção, meta de
// peças/hora), usando a fórmula clássica:
//
//   Disponibilidade = tempoProduzindo / tempoPlanejado
//   Performance      = produzido / produçãoTeórica(tempoProduzindo × meta_pecas_hora)
//   Qualidade        = (produzido - refugo) / produzido
//   OEE              = Disponibilidade × Performance × Qualidade
//
// tempoPlanejadoMin: não temos um campo explícito de "tempo planejado"
// vindo do EGA, então usamos minutos decorridos desde a meia-noite até
// agora como aproximação — é o "tempo disponível pra produção hoje até
// agora". Se um dia o EGA fornecer um campo de tempo planejado mais
// preciso (por turno, por exemplo), é só trocar aqui.
//
// Todos os valores de entrada em minutos ou unidades absolutas;
// retorno em percentual (0–100), pronto pra exibir.
// =====================================================================

function minutosDecorridosHoje() {
    const agora = new Date();
    return agora.getHours() * 60 + agora.getMinutes();
}

function calcularOEECompleto(dados) {

    const {
        tempoPlanejadoMin,
        tempoParadoMin,
        quantidadeProduzida,
        quantidadeRefugo,
        pecasPorHora
    } = dados;

    if (!tempoPlanejadoMin || tempoPlanejadoMin <= 0) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null };
    }

    const tempoProduzindoMin =
        Math.max(0, tempoPlanejadoMin - (tempoParadoMin || 0));

    let disponibilidade = tempoProduzindoMin / tempoPlanejadoMin;
    disponibilidade = Math.max(0, Math.min(1, disponibilidade));

    let performance = 0;

    if (tempoProduzindoMin > 0 && pecasPorHora > 0) {

        const producaoTeorica = (tempoProduzindoMin / 60) * pecasPorHora;

        if (producaoTeorica > 0) {
            performance = (quantidadeProduzida || 0) / producaoTeorica;
        }
    }

    performance = Math.max(0, Math.min(1, performance));

    let qualidade = 0;

    if (quantidadeProduzida > 0) {

        const quantidadeBoa =
            Math.max(0, quantidadeProduzida - (quantidadeRefugo || 0));

        qualidade = quantidadeBoa / quantidadeProduzida;

    } else {
        // sem produção registrada ainda hoje — não penaliza a
        // qualidade (ela some do produto final, já que produção = 0
        // zera o OEE de qualquer forma pela performance)
        qualidade = 1;
    }

    qualidade = Math.max(0, Math.min(1, qualidade));

    const oee = disponibilidade * performance * qualidade;

    return {
        disponibilidade: disponibilidade * 100,
        performance: performance * 100,
        qualidade: qualidade * 100,
        oee: oee * 100
    };
}


// =====================================================================
// OEE CONSOLIDADO DA LINHA — Dosadora + Plissadeira como UMA operação
// =====================================================================
//
// NÃO é média dos OEE individuais das máquinas. É a mesma fórmula de
// calcularOEECompleto() acima, mas aplicada sobre os dados-base já
// SOMADOS de todas as máquinas da linha (tempo planejado, tempo
// parado, produzido, refugo, produção teórica) — a linha tratada como
// uma operação única, e só então:
//
//   Disponibilidade_Linha × Performance_Linha × Qualidade_Linha
//
// Recebe um array de "dados" no mesmo formato aceito por
// calcularOEECompleto() (um item por máquina da linha) e devolve os
// índices já consolidados. Nenhum valor intermediário é arredondado —
// arredondamento só na hora de exibir.
// =====================================================================

function calcularOEELinhaConsolidado(maquinasDados) {

    if (!maquinasDados || !maquinasDados.length) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null };
    }

    let somaTempoPlanejado = 0;
    let somaTempoProduzindo = 0;
    let somaProducaoTeorica = 0;
    let somaProduzida = 0;
    let somaBoa = 0;

    maquinasDados.forEach(dados => {

        const tempoPlanejadoMin = dados.tempoPlanejadoMin || 0;
        if (tempoPlanejadoMin <= 0) return;

        const tempoParadoMin = dados.tempoParadoMin || 0;
        const tempoProduzindoMin = Math.max(0, tempoPlanejadoMin - tempoParadoMin);

        const quantidadeProduzida = dados.quantidadeProduzida || 0;
        const quantidadeRefugo = dados.quantidadeRefugo || 0;
        const quantidadeBoa = Math.max(0, quantidadeProduzida - quantidadeRefugo);

        const pecasPorHora = dados.pecasPorHora || 0;
        const producaoTeorica = (tempoProduzindoMin > 0 && pecasPorHora > 0)
            ? (tempoProduzindoMin / 60) * pecasPorHora
            : 0;

        somaTempoPlanejado += tempoPlanejadoMin;
        somaTempoProduzindo += tempoProduzindoMin;
        somaProducaoTeorica += producaoTeorica;
        somaProduzida += quantidadeProduzida;
        somaBoa += quantidadeBoa;
    });

    if (somaTempoPlanejado <= 0) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null };
    }

    let disponibilidade = somaTempoProduzindo / somaTempoPlanejado;
    disponibilidade = Math.max(0, Math.min(1, disponibilidade));

    let performance = somaProducaoTeorica > 0 ? somaProduzida / somaProducaoTeorica : 0;
    performance = Math.max(0, Math.min(1, performance));

    let qualidade = somaProduzida > 0 ? somaBoa / somaProduzida : 1;
    qualidade = Math.max(0, Math.min(1, qualidade));

    const oee = disponibilidade * performance * qualidade;

    return {
        disponibilidade: disponibilidade * 100,
        performance: performance * 100,
        qualidade: qualidade * 100,
        oee: oee * 100
    };
}


// =====================================================================
// OEE CONSOLIDADO DA LINHA — A PARTIR DOS ÍNDICES REAIS DO EGA
// =====================================================================
//
// Diferente de calcularOEELinhaConsolidado() acima (que ESTIMA os
// componentes a partir de paradas/produção sincronizadas pelo nosso
// próprio lado), esta função consolida a linha a partir dos números
// que o PRÓPRIO EGA já calculou:
//
//   - Disponibilidade: já vem pronta do EGA em machines.disponibilidade
//     (média do dia de OEE_HORARIO.ID) — não recalculamos.
//   - Performance: Σ qtde_produzida / Σ qtde_teorica de todas as
//     máquinas da linha (qtde_teorica = OEE_HORARIO.QTDE_TEORICA,
//     sincronizada por hora em producao_horaria) — igual o EGA faz
//     internamente, por isso reproduz o total "Dosadora + Plissadeira"
//     do relatório nativo.
//   - Qualidade: (Σ produzida − Σ rejeitada) / Σ produzida.
//
// A Disponibilidade da linha é a média das disponibilidades de cada
// máquina PONDERADA pelo número de faixas de hora com produção
// programada (QTDE_TEORICA > 0) — aproxima o peso por tempo real sem
// precisar sincronizar os segundos brutos de parada/disponível.
//
// IMPORTANTE: Performance aqui NÃO é limitada a 100%, porque o EGA
// também não limita (uma máquina pode operar acima do ritmo teórico).
// =====================================================================

function paraFracao01(valor) {
    if (valor == null || isNaN(Number(valor))) return null;
    const v = Number(valor);
    // mesmo critério de calcularOeeMaquina(): valores <= 1.5 já são
    // fração (0–1), valores maiores já vêm em percentual (0–100)
    return v <= 1.5 ? v : v / 100;
}

function calcularOEELinhaEGA(maquinasDaLinha) {

    if (!maquinasDaLinha || !maquinasDaLinha.length) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null, completo: false };
    }

    let somaTeorica = 0;
    let somaProduzida = 0;
    let somaRejeitada = 0;
    let somaDisponibilidadePonderada = 0;
    let somaPeso = 0;

    maquinasDaLinha.forEach(m => {

        const teorica = Number(m.qtdeTeorica) || 0;
        const produzida = Number(m.qtdeProduzida) || 0;
        const rejeitada = Number(m.qtdeRejeitada) || 0;
        const peso = Number(m.horasQualificadas) || 0;

        somaTeorica += teorica;
        somaProduzida += produzida;
        somaRejeitada += rejeitada;

        const dispFracao = paraFracao01(m.disponibilidade);
        if (dispFracao != null && peso > 0) {
            somaDisponibilidadePonderada += dispFracao * peso;
            somaPeso += peso;
        }
    });

    // sem qtde_teorica sincronizada ainda (coluna nova / sync antigo) —
    // sinaliza "incompleto" pra quem chamou decidir se cai no fallback
    if (somaTeorica <= 0) {
        return { disponibilidade: null, performance: null, qualidade: null, oee: null, completo: false };
    }

    const disponibilidade = somaPeso > 0
        ? somaDisponibilidadePonderada / somaPeso
        : null;

    const performance = somaProduzida / somaTeorica; // sem clipping — EGA também não limita

    const qualidade = somaProduzida > 0
        ? Math.max(0, Math.min(1, (somaProduzida - somaRejeitada) / somaProduzida))
        : 1;

    if (disponibilidade == null) {
        return { disponibilidade: null, performance: performance * 100, qualidade: qualidade * 100, oee: null, completo: false };
    }

    const dispClipada = Math.max(0, Math.min(1, disponibilidade));
    const oee = dispClipada * performance * qualidade;

    return {
        disponibilidade: dispClipada * 100,
        performance: performance * 100,
        qualidade: qualidade * 100,
        oee: oee * 100,
        completo: true
    };
}


// =====================================================================
// TURNO — tradução do código pra descrição/horário
// =====================================================================
//
// Fonte única: qualquer página que precisar mostrar o turno usa esta
// função, alimentada pela tabela turnos_config (catálogo sincronizado
// de dbo.TURNOS).
// =====================================================================

function formatarTurno(codigoTurno, turnosConfig) {

    if (codigoTurno == null) return "—";

    const config = (turnosConfig || []).find(
        t => Number(t.codigo_turno) === Number(codigoTurno)
    );

    if (!config) return `Turno ${codigoTurno}`;

    return config.descricao || `Turno ${codigoTurno}`;
}


// =====================================================================
// MOTIVOS DE PARADA — planejado vs não planejado
// =====================================================================
//
// Constrói um mapa DESCRICAO (maiúsculo) -> { previsto, ... } a partir
// da tabela stop_reasons (catálogo sincronizado de dbo.PARADAS). Usado
// pra classificar cada parada em planejada/não-planejada de forma
// consistente em todas as telas, sem reimplementar a lógica.
// =====================================================================

function construirMapaMotivos(stopReasons) {

    const mapa = {};

    (stopReasons || []).forEach(m => {
        if (!m.descricao) return;
        mapa[m.descricao.toUpperCase()] = m;
    });

    return mapa;
}

function paradaEhPlanejada(reason, mapaMotivos) {

    if (!reason) return false;

    const encontrado = mapaMotivos[reason.toUpperCase()];

    // Se o motivo não estiver no catálogo (ex.: stop_reasons ainda não
    // sincronizado), assume não-planejada por segurança — é a leitura
    // mais conservadora pra um indicador de perda.
    return encontrado ? !!encontrado.parada_prevista : false;
}


// =====================================================================
// PARADA AUTOMÁTICA — motivo que o EGA abre/fecha sozinho (ex.: "SEM
// EXPEDIENTE"), sem o operador registrar nada. Usado pra tirar isso
// dos alertas do dashboard, que devem mostrar só paradas de verdade.
// =====================================================================

function paradaEhAutomatica(reason, mapaMotivos) {

    if (!reason) return false;

    // Só confia no texto do motivo ("SEM EXPEDIENTE" é inequívoco).
    // Chegou a usar também o campo saida_automatica do catálogo
    // (stop_reasons), mas isso escondia paradas de verdade dos
    // alertas (AGUARD. ELEMENTO, RECICLO, REFEIÇÃO etc. vinham
    // marcadas como "automáticas" no EGA sem serem, no sentido de
    // "não é um problema real") — removido por segurança.
    return reason.toUpperCase().includes("SEM EXPEDIENTE");
}
