
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
    "https://oamcihyacbodbtnwptpb.supabase.co";

// Chave "publishable" — segura pra ficar exposta no navegador. Só
// consegue LER (SELECT), porque o RLS das tabelas não tem nenhuma
// policy de escrita pra role "anon". Quem escreve é o sync.js, usando
// a chave "secret" (sync/.env) — essa nunca deve vir pra cá.
const SUPABASE_ANON_KEY =
    "sb_publishable_fZHdZoBZcQbzeZkQ1_95Jw_k8LWMS-1";


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
        "producao_horaria",

    METAS_DIARIAS:
        "metas_diarias",

    CATALOGO_ITENS:
        "catalogo_itens",

    SEQUENCIA_PRODUCAO:
        "sequencia_producao",

    OPERADOR_HISTORICO:
        "operador_historico",

    INDICES_CONFIG:
        "indices_config"
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

// =====================================================================
// PARADA DENTRO DO TURNO — filtro pro Pareto/KPIs de parada
// =====================================================================
//
// O MOVIMENTACAO do EGA loga, em várias linhas, o período ANTES do
// turno começar sob um motivo com nome de problema real (ex.:
// "FALTA ENERGIA", "SEM EXPEDIENTE"), fatiado hora a hora desde meia-
// noite — mesmo sem ser um problema de produção de verdade (é só "o
// turno ainda não começou"). Em vez de caçar motivo por motivo, filtra
// pela agenda real da linha (mesma usada no cálculo de OEE): só conta
// como parada de produção o que aconteceu DENTRO do turno.
// =====================================================================

function paradaDentroDoTurno(parada, numeroLinha) {

    if (!numeroLinha) return true; // sem linha identificada — não filtra, comportamento anterior

    const inicioParada = new Date(parada.started_at);
    const { inicio, fim } = janelaDeHorasDaLinha(numeroLinha, inicioParada);
    const hora = inicioParada.getHours();

    return hora >= inicio && hora <= fim;
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

// =====================================================================
// METAS DIÁRIAS POR LINHA
// =====================================================================
//
// 2026-09: agora vêm da tabela metas_diarias (editável pelo papel
// "admin" — ver web/admin/admin.js). Esse objeto virou só o FALLBACK
// pra quando a tabela estiver vazia ou inacessível, pra nunca quebrar
// os cards que dependem disso (Atendimento da meta diária no
// Supervisor, resumo de meta no Sequenciador/PCP).
// =====================================================================

const METAS_DIARIAS_POR_LINHA_FALLBACK = {
    1: 1200,
    2: 900,
    3: 700,
    4: 270,
    5: 900
};

// mantido pelo nome antigo por compatibilidade — só o fallback
const METAS_DIARIAS_POR_LINHA = METAS_DIARIAS_POR_LINHA_FALLBACK;

// busca as metas reais no Supabase; qualquer linha que não tiver uma
// linha cadastrada (ou se a tabela toda estiver inacessível) usa o
// fallback pra ela especificamente, não trava a tela inteira
async function buscarMetasDiarias() {

    const resultado = { ...METAS_DIARIAS_POR_LINHA_FALLBACK };

    const { data, error } = await supabaseClient
        .from(TABELAS.METAS_DIARIAS)
        .select("numero_linha, meta_pecas");

    if (error) {
        console.error("Erro ao buscar metas_diarias (usando fallback):", error);
        return resultado;
    }

    (data || []).forEach(linha => {
        if (linha.numero_linha != null && linha.meta_pecas != null) {
            resultado[linha.numero_linha] = Number(linha.meta_pecas);
        }
    });

    return resultado;
}

// =====================================================================
// SEQUÊNCIA DE PRODUÇÃO — gerada pelo PCP (Sequenciador), lida pela
// tela do operador (minha_maquina.js). Uma "etapa" por linha
// ("plissadeira" ou "dosadora") — cada geração nova do PCP substitui
// a anterior daquela linha+etapa por inteiro.
// =====================================================================

async function buscarSequenciaDaMaquina(numeroLinha, etapa) {

    const { data, error } = await supabaseClient
        .from(TABELAS.SEQUENCIA_PRODUCAO)
        .select("*")
        .eq("numero_linha", numeroLinha)
        .eq("etapa", etapa)
        .order("posicao", { ascending: true });

    if (error) {
        console.error("Erro ao buscar sequência de produção:", error);
        return [];
    }

    return data || [];
}


// =====================================================================
// CATÁLOGO DE ITENS — cadastro permanente (tabela catalogo_itens,
// editada pelo papel "admin"). Usado pelo Sequenciador (PCP) pra
// cruzar cada OP com Grupo/Cor/Marca Privada/Altura de Dobra/Linha.
// =====================================================================

async function buscarCatalogoItens() {

    const { data, error } = await supabaseClient
        .from(TABELAS.CATALOGO_ITENS)
        .select("*")
        .order("codigo_item", { ascending: true });

    if (error) {
        console.error("Erro ao buscar catalogo_itens:", error);
        return { itens: [], erro: error };
    }

    return { itens: data || [], erro: null };
}

// mesmo formato que montarItensSequenciaveis() (pcp.js) espera —
// Map codigoItem -> { grupo, cor, marcaPrivada, alturaDeDobra, papel,
// numeroLinha }
function catalogoParaMapa(itens) {

    const mapa = new Map();

    (itens || []).forEach(linha => {
        const codigo = String(linha.codigo_item || "").toUpperCase().trim();
        if (!codigo) return;

        mapa.set(codigo, {
            codigoItem: codigo,
            grupo: linha.grupo || "",
            cor: linha.cor || "",
            marcaPrivada: linha.marca_privada || "",
            alturaDeDobra: linha.altura_de_dobra != null ? Number(linha.altura_de_dobra) : null,
            papel: linha.papel || "",
            numeroLinha: linha.numero_linha != null ? Number(linha.numero_linha) : null,
            observacoes: linha.observacoes || ""
        });
    });

    // segunda passada: registra também pelo código anotado no campo
    // Observações (quando existir) — pra achar itens cujo código na
    // planilha de OPs não bate com o código principal do item
    // cadastrado. Só entra como chave extra se essa chave ainda não
    // existir (nunca sobrescreve uma correspondência pelo código real).
    mapa.forEach(entrada => {
        const alternativo = String(entrada.observacoes || "").toUpperCase().trim();
        if (alternativo && !mapa.has(alternativo)) {
            mapa.set(alternativo, entrada);
        }
    });

    return mapa;
}


// =====================================================================
// ÍNDICES DE CLASSIFICAÇÃO (cores verde/amarelo/vermelho) — editáveis
// pelo Administrador. Fallback = valores que já estavam fixos no
// código (produção ≥80%/≥60%, OEE ≥70%/≥65%) — se a tabela ainda não
// existir ou a busca falhar, o painel continua funcionando igual.
// =====================================================================

const INDICES_CONFIG_FALLBACK = {
    producao: { bom: 80, atencao: 60 },
    oee: { bom: 70, atencao: 65 }
};

const INDICES_CONFIG = {
    producao: { ...INDICES_CONFIG_FALLBACK.producao },
    oee: { ...INDICES_CONFIG_FALLBACK.oee }
};

async function carregarIndicesConfig() {

    const { data, error } = await supabaseClient
        .from(TABELAS.INDICES_CONFIG)
        .select("chave, limite_bom, limite_atencao");

    if (error) {
        console.error("Erro ao carregar indices_config (usando fallback):", error);
        return INDICES_CONFIG;
    }

    (data || []).forEach(linha => {
        if (INDICES_CONFIG[linha.chave] && linha.limite_bom != null && linha.limite_atencao != null) {
            INDICES_CONFIG[linha.chave] = {
                bom: Number(linha.limite_bom),
                atencao: Number(linha.limite_atencao)
            };
        }
    });

    return INDICES_CONFIG;
}

// separa "linha" (número 1-5) de "etapa" (plissadeira/dosadora) a
// partir do nome da máquina — usado no Sequenciador (PCP) e no card de
// sequência da tela do operador
function etapaDaMaquina(nomeLinha) {
    const texto = (nomeLinha || "").toUpperCase();
    if (texto.includes("PLISSADEIRA")) return "plissadeira";
    if (texto.includes("DOSADORA")) return "dosadora";
    return null;
}

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
// PARADA AUTOMÁTICA — motivos que NÃO devem contar como parada real
// nos alertas/KPIs do dashboard: "SEM EXPEDIENTE" (o EGA abre/fecha
// sozinho, fora do turno), "RECICLO" e "OS FINALIZADA" (confirmado
// pelo usuário — 2026-09), e "EGA INOPERANTE" (significa que o EGA
// perdeu comunicação com a máquina — a linha da TABCACHE congela no
// último contato, então "desde" pode ficar preso em qualquer data
// antiga; não é uma parada de produção de hoje, é falta de
// comunicação — confirmado 2026-09).
// =====================================================================

function paradaEhAutomatica(reason, mapaMotivos) {

    if (!reason) return false;

    // Lista explícita por texto do motivo, decidida junto com o
    // usuário — de propósito NÃO usa o campo saida_automatica do
    // catálogo (stop_reasons): já tentamos isso antes e ele marcava
    // parada de verdade (AGUARD. ELEMENTO, REFEIÇÃO etc.) como
    // "automática" sem ser, escondendo problema real dos alertas.
    const motivo = reason.toUpperCase();
    return motivo.includes("SEM EXPEDIENTE")
        || motivo.includes("RECICLO")
        || motivo.includes("OS FINALIZADA")
        || motivo.includes("EGA INOPERANTE");
}
