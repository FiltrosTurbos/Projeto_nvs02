// =====================================================================
// TELA: PCP — Sequenciador de OPs
// =====================================================================
//
// O catálogo de itens (Grupo/Cor/Altura de Dobra/Linha) vem do cadastro
// permanente (tabela catalogo_itens, mantida pelo papel "admin") — só a
// planilha de OPs do dia é importada aqui, lida inteiramente no
// navegador. Nada disso é escrito de volta no EGA.
// =====================================================================

exigirPapel(["pcp", "admin"]);


// =====================================================================
// ELEMENTOS DA TELA
// =====================================================================

const connectionPill = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");

const inputOps = document.getElementById("input-ops");
const inputDataAlvo = document.getElementById("input-data-alvo");
const statusCatalogo = document.getElementById("status-catalogo");
const statusOps = document.getElementById("status-ops");
const uploadCatalogoEl = document.getElementById("upload-catalogo");
const uploadOpsEl = document.getElementById("upload-ops");
const btnSequenciar = document.getElementById("btn-sequenciar");
const btnImprimir = document.getElementById("btn-imprimir");
const avisoEl = document.getElementById("pcp-aviso");
const resultadoEl = document.getElementById("pcp-resultado");

const filtroLinhasSecao = document.getElementById("pcp-filtro-linhas-secao");
const checksFiltroLinha = document.querySelectorAll(".pcp-filtro-linha-check");
const btnFiltroTodas = document.getElementById("btn-filtro-todas");
const btnFiltroNenhuma = document.getElementById("btn-filtro-nenhuma");

let catalogoMapa = null;
let opsLinhas = null;
let metasDiarias = METAS_DIARIAS_POR_LINHA_FALLBACK;

// quais linhas mostrar (todas, por padrão) — puramente visual, não
// afeta o que já foi gerado/salvo, só o que aparece na tela
let linhasVisiveis = new Set([1, 2, 3, 4, 5]);

// última sequência gerada, guardada em memória pra dar pra reordenar
// manualmente sem precisar gerar tudo de novo — { linha: { plissadeira,
// dosadora, alteradoManualmente: { plissadeira: bool, dosadora: bool } } }
let filasPorLinhaAtual = null;
let dataAlvoAtual = null;

// data no formato "YYYY-MM-DD" (o <input type="date"> usa esse
// formato), no fuso de Brasília — por padrão, amanhã
function dataDeAmanha() {
    const agora = new Date();
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    const ano = amanha.getFullYear();
    const mes = String(amanha.getMonth() + 1).padStart(2, "0");
    const dia = String(amanha.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
}

// lembra a última data escolhida (localStorage) — sem isso, toda vez
// que a página recarregava (ex.: voltando de outra tela), o filtro
// pulava de volta pra "amanhã" sozinho, dando a impressão de que a
// sequência de hoje tinha sumido (ela continuava salva, só o filtro
// de visualização é que tinha mudado)
const CHAVE_ULTIMA_DATA_PCP = "pcp_ultima_data_sequencia";

function dataInicialDoFiltro() {
    const salva = localStorage.getItem(CHAVE_ULTIMA_DATA_PCP);
    return salva || dataDeAmanha();
}

if (inputDataAlvo) inputDataAlvo.value = dataInicialDoFiltro();

// =====================================================================
// CARREGAR SEQUÊNCIA JÁ PUBLICADA — se o PCP já gerou (e talvez já
// ajustou manualmente) a sequência de uma data, recarregar a página
// não pode perder isso. Busca do banco e reconstrói o mesmo formato
// que a geração usa, pra reordenar continuar funcionando sem precisar
// subir a planilha de novo (o que reescreveria por cima do ajuste
// manual já feito).
// =====================================================================

async function carregarSequenciaExistente(dataAlvo) {

    const { data, error } = await supabaseClient
        .from(TABELAS.SEQUENCIA_PRODUCAO)
        .select("*")
        .eq("data", dataAlvo)
        .order("numero_linha", { ascending: true })
        .order("posicao", { ascending: true });

    if (error) {
        console.error("Erro ao buscar sequência existente:", error);
        return;
    }

    if (!data || !data.length) return; // nada publicado ainda pra essa data

    const filasPorLinha = {};

    data.forEach(linha => {

        const n = linha.numero_linha;

        if (!filasPorLinha[n]) {
            filasPorLinha[n] = {
                plissadeira: n === 5 ? null : [],
                dosadora: [],
                alteradoManualmente: { plissadeira: false, dosadora: false }
            };
        }

        const item = {
            op: linha.op,
            codigoItem: linha.codigo_item,
            qtdeItem: Number(linha.qtde_item) || 0,
            cor: linha.cor || "",
            alturaDeDobra: linha.altura_de_dobra != null ? Number(linha.altura_de_dobra) : null,
            eixo: linha.eixo,
            emMaquinaAgora: !!linha.em_maquina_agora,
            encontradoNoCatalogo: true,
            marcaPrivada: "",
            grupo: ""
        };

        if (linha.etapa === "plissadeira" && filasPorLinha[n].plissadeira) {
            filasPorLinha[n].plissadeira.push(item);
        } else if (linha.etapa === "dosadora") {
            filasPorLinha[n].dosadora.push(item);
        }

        if (linha.alterado_manualmente) {
            filasPorLinha[n].alteradoManualmente[linha.etapa] = true;
        }
    });

    filasPorLinhaAtual = filasPorLinha;
    dataAlvoAtual = dataAlvo;

    renderizarResultado(filasPorLinha, dataAlvo);
    btnImprimir.hidden = false;

    avisoEl.textContent = `Carreguei a sequência já publicada pra ${formatarDataBR(dataAlvo)} — pode reordenar direto aqui embaixo, ou gerar de novo se subir uma planilha de OPs atualizada (isso substitui a sequência inteira dessa data).`;
}

if (inputDataAlvo) {
    inputDataAlvo.addEventListener("change", () => {
        if (inputDataAlvo.value) localStorage.setItem(CHAVE_ULTIMA_DATA_PCP, inputDataAlvo.value);
        avisoEl.textContent = "";
        resultadoEl.innerHTML = "";
        btnImprimir.hidden = true;
        if (filtroLinhasSecao) filtroLinhasSecao.hidden = true;
        filasPorLinhaAtual = null;
        dataAlvoAtual = null;
        if (inputDataAlvo.value) carregarSequenciaExistente(inputDataAlvo.value);
    });
}


// =====================================================================
// STATUS DA CONEXÃO — só usado aqui pra confirmar que dá pra ler
// machines.op (usado pra achar "Em Máquina Agora")
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


// =====================================================================
// ROLO DE FACAS POR ALTURA DE DOBRA
// =====================================================================
//
// Construída a partir de ALTURA_DE_DOBRAS_POR_FACAS.xlsx (2026-09).
// Quando uma altura pode ser feita em mais de um eixo (ex.: altura 49
// existe tanto no eixo de 6 quanto no de 8 facas), vale a regra
// combinada com os operadores: usar sempre o MAIOR eixo disponível
// pra aquela altura.
// =====================================================================

const EIXOS_POR_ALTURA = {
    9: 36,
    12: 28,
    15: 22, 16: 22, 17: 22, 18: 22, 19: 22, 20: 22, 21: 22,
    22: 15, 23: 15, 24: 15,
    25: 12, 26: 12, 27: 12, 28: 12, 29: 12, 30: 12, 31: 12, 32: 12, 33: 12, 34: 12,
    35: 8, 36: 8, 37: 8, 38: 8, 39: 8, 40: 8, 41: 8, 42: 8, 43: 8,
    44: 8, 45: 8, 46: 8, 47: 8, 48: 8, 49: 8, 51: 8,
    50: 6, 52: 6, 53: 6, 54: 6, 55: 6, 56: 6, 57: 6, 58: 6, 59: 6, 60: 6, 63: 6
};

function eixoParaAltura(altura) {
    const n = Number(altura);
    if (isNaN(n)) return null;
    return EIXOS_POR_ALTURA[n] != null ? EIXOS_POR_ALTURA[n] : null;
}


// =====================================================================
// HIERARQUIA DE SEQUENCIAMENTO
// =====================================================================
//
// 1. Em Máquina Agora — sempre primeiro (vem de machines.op, ao vivo)
// 2. Cor — 30min de troca (Preto antes de Vermelho)
// 3. Rolo de Facas — 15min de troca (deduzido da altura de dobra)
// 4. Altura de Dobra — decrescente, 1,5min por ajuste
// 5. Marca Privada — só desempate
// 6. Grupo — itens do mesmo grupo NUNCA se separam (regra dura)
// =====================================================================

const PRIORIDADE_COR = { "PRETO": 0, "VERMELHO": 1 };

function prioridadeCor(cor) {
    const c = (cor || "").toUpperCase().trim();
    return PRIORIDADE_COR[c] != null ? PRIORIDADE_COR[c] : 2;
}

function compararItens(a, b) {

    const pa = prioridadeCor(a.cor);
    const pb = prioridadeCor(b.cor);
    if (pa !== pb) return pa - pb;

    // cores "outras" (nem Preto nem Vermelho) — desempata por ordem
    // alfabética, só pra não ficar em ordem arbitrária
    if (pa === 2) {
        const compCor = (a.cor || "").localeCompare(b.cor || "");
        if (compCor !== 0) return compCor;
    }

    const ea = a.eixo == null ? 999 : a.eixo;
    const eb = b.eixo == null ? 999 : b.eixo;
    if (ea !== eb) return ea - eb;

    const alturaA = a.alturaDeDobra == null ? -Infinity : Number(a.alturaDeDobra);
    const alturaB = b.alturaDeDobra == null ? -Infinity : Number(b.alturaDeDobra);
    if (alturaA !== alturaB) return alturaB - alturaA; // decrescente

    return (a.marcaPrivada || "").localeCompare(b.marcaPrivada || "");
}

// agrupa itens pelo mesmo código de Grupo (quando existe) — cada grupo
// vira um "bloco" que se move junto na ordenação, nunca é separado. A
// chave de ordenação do bloco é o primeiro item dele.
function agruparPorGrupo(itens) {

    const porGrupo = new Map();
    const ordemGrupos = [];
    const semGrupo = [];

    itens.forEach(item => {
        const g = (item.grupo || "").trim();
        if (!g) {
            semGrupo.push(item);
            return;
        }
        if (!porGrupo.has(g)) {
            porGrupo.set(g, []);
            ordemGrupos.push(g);
        }
        porGrupo.get(g).push(item);
    });

    const blocos = ordemGrupos.map(g => {
        const membros = porGrupo.get(g);
        return { chave: membros[0], itens: membros };
    });

    semGrupo.forEach(item => blocos.push({ chave: item, itens: [item] }));

    return blocos;
}

// ordena os itens de uma linha pelas regras de setup — SEM pinar
// "em máquina agora" ainda, porque isso agora é feito por ETAPA
// (Plissadeira e Dosadora têm cada uma sua própria máquina/OP atual)
function ordenarItensDaLinha(itensDaLinha) {

    const blocos = agruparPorGrupo(itensDaLinha);
    blocos.sort((a, b) => compararItens(a.chave, b.chave));

    return blocos.flatMap(b => b.itens);
}

// =====================================================================
// TEMPO DE SETUP ESTIMADO — quantifica o valor da sequência
// =====================================================================
//
// Conta, entre cada par de itens CONSECUTIVOS na ordem final (a mesma
// que a máquina vai rodar de verdade), quantas trocas de cada tipo
// acontecem, e soma pelos custos já definidos: Cor 30min, Rolo de
// Facas 15min, Altura de Dobra 1,5min. Cada tipo de troca conta
// independente dos outros (mesmo se acontecerem juntas) — é a mesma
// lógica usada no outro sequenciador (Otimizador de Sequência) pra
// validar economia de setup.
// =====================================================================

function calcularSetupEstimado(sequencia) {

    let trocasCor = 0, trocasRolo = 0, trocasAltura = 0;

    for (let i = 1; i < sequencia.length; i++) {

        const anterior = sequencia[i - 1];
        const atual = sequencia[i];

        if ((atual.cor || "") !== (anterior.cor || "")) trocasCor++;
        if (atual.eixo !== anterior.eixo) trocasRolo++;
        if (atual.alturaDeDobra !== anterior.alturaDeDobra) trocasAltura++;
    }

    const minutos = trocasCor * 30 + trocasRolo * 15 + trocasAltura * 1.5;

    return { trocasCor, trocasRolo, trocasAltura, minutos };
}

function formatarMinutos(minutos) {
    const totalMin = Math.round(minutos);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m}min`;
    return `${h}h${m > 0 ? " " + m + "min" : ""}`;
}

// número de OP comparável entre fontes diferentes — a planilha exporta
// com zeros à esquerda (ex.: "00130427"), o EGA/machines.op vem sem
// (ex.: "130427") — sem isso, a comparação nunca batia e a OP em
// máquina nunca era destacada
function normalizarOP(valor) {
    const texto = String(valor ?? "").trim();
    return texto.replace(/^0+(?=\d)/, "");
}

// bota na frente o(s) item(ns) cuja OP está rodando agora numa máquina
// específica (Plissadeira OU Dosadora daquela linha) — não mexe na
// ordem relativa do resto
function pinarEmMaquinaAgora(sequenciaOrdenada, opsAtuais) {

    if (!opsAtuais || !opsAtuais.length) return sequenciaOrdenada;

    const opsAtuaisMap = new Map(opsAtuais.map(o => [normalizarOP(o.op), o.maquina]));

    const naMaquina = [];
    const resto = [];

    sequenciaOrdenada.forEach(item => {
        const opTexto = normalizarOP(item.op);
        if (opsAtuaisMap.has(opTexto)) {
            naMaquina.push({ ...item, emMaquinaAgora: opsAtuaisMap.get(opTexto) });
        } else {
            resto.push(item);
        }
    });

    return [...naMaquina, ...resto];
}

// =====================================================================
// PLISSADEIRA → DOSADORA — fluxo contínuo (2026-09)
// =====================================================================
//
// A OP desce pro almoxarifado, é separada, passa pela Plissadeira e só
// DEPOIS vai pra Dosadora finalizar — é a MESMA OP nas duas etapas.
//
// NÃO usamos mais QTD.PROCESSADA da planilha pra decidir o que já
// passou pela Plissadeira — a planilha agora serve só pra saber QUAIS
// itens/OPs precisam ser sequenciados. Tudo o mais vem do EGA ao vivo:
// achamos a posição da OP que a Plissadeira está rodando AGORA
// (machines.op) dentro da própria ordem que calculamos — tudo que vem
// ANTES dela na sequência já passou (pronto pra Dosadora); a OP atual
// e as que vêm depois continuam na fila da Plissadeira.
//
// A Dosadora NÃO tem uma ordenação própria — ela usa exatamente a
// mesma ordem calculada pra Plissadeira (ordenarItensDaLinha), só que
// recortada nesse ponto. Isso evita a Plissadeira e a Dosadora
// acabarem em sequências diferentes.
//
// Linha 5 não tem Plissadeira — a Dosadora sequencia direto, sem esse
// corte. Linha 4 tem duas Dosadoras (Baixa/Média), tratadas como uma
// fila só — isso já cai de graça, porque a planilha não distingue
// qual das duas vai rodar cada OP.
// =====================================================================

// separa a sequência em "já passou pela Plissadeira" / "ainda não",
// usando a posição da OP atual dela (machines.op) dentro da própria
// ordem calculada
function separarPelaPosicaoAtual(ordem, opAtualPlissadeira) {

    if (!opAtualPlissadeira) {
        // não sabemos o que a Plissadeira está rodando agora — por
        // segurança, ninguém é considerado "pronto" ainda
        return { prontos: [], pendentes: ordem, semReferencia: true };
    }

    const idx = ordem.findIndex(item => normalizarOP(item.op) === opAtualPlissadeira);

    if (idx === -1) {
        // a OP que a Plissadeira está rodando não está na planilha
        // importada — não dá pra saber o corte com segurança
        return { prontos: [], pendentes: ordem, semReferencia: true };
    }

    return {
        prontos: ordem.slice(0, idx),
        pendentes: ordem.slice(idx), // inclui a OP atual + as seguintes
        semReferencia: false
    };
}

// =====================================================================
// META DIÁRIA DA LINHA — só informativo (não corta a fila)
// =====================================================================
//
// METAS_DIARIAS_POR_LINHA vem de shared/supabaseClient.js (mesma
// constante usada no card "Atendimento da meta diária" do Supervisor).
// Aqui só soma QTD. ITEM da fila do dia e mostra ao lado da meta, pra
// o PCP ver se o que já tem sequenciado cobre o dia ou não — não
// esconde, não reordena, não corta nenhuma OP.
// =====================================================================

function somaQtdeItem(itens) {
    return itens.reduce((soma, item) => soma + (Number(item.qtdeItem) || 0), 0);
}

function montarFilasDaLinha(numeroLinha, itensDaLinha, opsAtuaisPlissadeira, opsAtuaisDosadora) {

    const ordem = ordenarItensDaLinha(itensDaLinha);
    const setup = calcularSetupEstimado(ordem);

    if (numeroLinha === 5) {
        return {
            plissadeira: null,
            dosadora: pinarEmMaquinaAgora(ordem, opsAtuaisDosadora),
            setup
        };
    }

    // uma linha física só tem 1 Plissadeira — usa a primeira entrada
    const opAtualPlissadeira = opsAtuaisPlissadeira && opsAtuaisPlissadeira[0]
        ? opsAtuaisPlissadeira[0].op
        : null;

    const { prontos, pendentes, semReferencia } = separarPelaPosicaoAtual(ordem, opAtualPlissadeira);

    return {
        plissadeira: pinarEmMaquinaAgora(pendentes, opsAtuaisPlissadeira),
        dosadora: pinarEmMaquinaAgora(prontos, opsAtuaisDosadora),
        semReferenciaPlissadeira: semReferencia,
        setup
    };
}


// =====================================================================
// LEITURA DAS PLANILHAS (.xlsx, 100% no navegador)
// =====================================================================

function normalizarTexto(valor) {
    return String(valor ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();
}

function acharColuna(linhaCabecalho, candidatos) {
    for (const candidato of candidatos) {
        const idx = linhaCabecalho.findIndex(
            celula => normalizarTexto(celula).includes(normalizarTexto(candidato))
        );
        if (idx !== -1) return idx;
    }
    return -1;
}

function acharLinhaCabecalho(matriz, palavrasChave) {
    for (let i = 0; i < matriz.length; i++) {
        const linha = (matriz[i] || []).map(normalizarTexto);
        if (palavrasChave.some(p => linha.some(c => c.includes(normalizarTexto(p))))) {
            return i;
        }
    }
    return -1;
}

async function lerMatrizXlsx(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(primeiraAba, { header: 1, defval: null, raw: true });
}

function extrairNumeroLinha(valor) {
    const m = String(valor ?? "").match(/(\d)/);
    return m ? Number(m[1]) : null;
}

async function processarOps(file) {

    const matriz = await lerMatrizXlsx(file);
    const idxCabecalho = acharLinhaCabecalho(matriz, ["PRODUTO"]);

    if (idxCabecalho === -1) {
        throw new Error('Não achei a coluna "PRODUTO" nessa planilha.');
    }

    const cabecalho = matriz[idxCabecalho];

    const col = {
        op: acharColuna(cabecalho, ["OP"]),
        produto: acharColuna(cabecalho, ["PRODUTO"]),
        status: acharColuna(cabecalho, ["STATUS"]),
        linha: acharColuna(cabecalho, ["LINHA"]),
        qtdeItem: acharColuna(cabecalho, ["QTD. ITEM", "QTD ITEM"])
    };

    const linhas = [];

    for (let i = idxCabecalho + 1; i < matriz.length; i++) {

        const linha = matriz[i];
        if (!linha || col.produto === -1) continue;

        const produto = String(linha[col.produto] ?? "").trim();
        if (!produto) continue;

        const status = col.status !== -1 ? String(linha[col.status] ?? "").trim() : "";

        // só considera OPs já separadas — "EM SEPARAÇÃO", "PENDENTE" e
        // "EM PRODUÇÃO" ficam de fora (ainda não é hora de sequenciar,
        // ou já está rodando e cai em machines.op)
        if (!normalizarTexto(status).includes("SEPARADA")) continue;

        const codigoItem = normalizarTexto(produto.split(/\s+/)[0]);
        const linhaTexto = col.linha !== -1 ? linha[col.linha] : null;

        linhas.push({
            op: col.op !== -1 ? String(linha[col.op] ?? "").trim() : "",
            produto,
            codigoItem,
            status,
            numeroLinha: extrairNumeroLinha(linhaTexto),
            qtdeItem: col.qtdeItem !== -1 ? Number(linha[col.qtdeItem]) || 0 : 0
        });
    }

    if (linhas.length === 0) {
        throw new Error("A planilha de OPs não tem nenhuma linha válida (ou está tudo como EM PRODUÇÃO).");
    }

    return linhas;
}

function montarItensSequenciaveis(opsList, catalogo) {
    return opsList.map(op => {

        const item = catalogo.get(op.codigoItem) || null;
        const alturaDeDobra = item && item.alturaDeDobra != null ? Number(item.alturaDeDobra) : null;

        // se a planilha de OPs não trouxe a linha (ou veio ambígua), usa
        // a linha cadastrada no catálogo pra esse item como reforço
        const numeroLinha = op.numeroLinha != null ? op.numeroLinha : (item ? item.numeroLinha : null);

        // Linhas 4 e 5 não usam rolo de facas — não faz sentido deduzir
        // (nem mostrar) esse dado pra elas
        const usaRoloDeFacas = numeroLinha !== 4 && numeroLinha !== 5;
        const eixo = usaRoloDeFacas && alturaDeDobra != null ? eixoParaAltura(alturaDeDobra) : null;

        return {
            ...op,
            numeroLinha,
            grupo: item ? item.grupo : "",
            cor: item ? item.cor : "",
            marcaPrivada: item ? item.marcaPrivada : "",
            alturaDeDobra,
            eixo,
            papel: item ? item.papel : "",
            encontradoNoCatalogo: !!item
        };
    });
}


// =====================================================================
// "EM MÁQUINA AGORA" — via machines.op, sincronizado ao vivo do EGA
// =====================================================================

async function buscarMaquinasAtuais() {

    const { data, error } = await supabaseClient
        .from(TABELAS.MACHINES)
        .select("id, line, op");

    if (error) {
        console.error("Erro ao buscar machines:", error);
        setConexao("erro");
        return [];
    }

    setConexao("online");
    return data || [];
}

// separa "linha" (número 1-5) de "etapa" (plissadeira/dosadora) a
// partir do nome da máquina — mesmo padrão já usado no resto do painel
// etapaDaMaquina() agora vem de shared/supabaseClient.js (fonte
// única, reaproveitada pela tela do operador também).

function construirOpsAtuaisPorLinha(maquinas) {

    const plissadeira = {};
    const dosadora = {};

    maquinas.forEach(m => {
        const numeroLinha = grupoDaLinha(m.line);
        const opTexto = normalizarOP(m.op);
        if (!numeroLinha || !opTexto) return;

        const etapa = etapaDaMaquina(m.line);
        const alvo = etapa === "plissadeira" ? plissadeira : etapa === "dosadora" ? dosadora : null;
        if (!alvo) return;

        if (!alvo[numeroLinha]) alvo[numeroLinha] = [];
        alvo[numeroLinha].push({ op: opTexto, maquina: m.line });
    });

    return { plissadeira, dosadora };
}


// =====================================================================
// RENDERIZAÇÃO
// =====================================================================

function escaparHtml(texto) {
    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderizarTabela(itens, tituloVazio, mostrarRoloDeFacas, numeroLinha, etapa) {

    if (!itens.length) {
        return `<div class="empty-message">${tituloVazio}</div>`;
    }

    const linhasHtml = itens.map((item, i) => {

        const tags = [
            item.emMaquinaAgora
                ? `<span class="pcp-tag">EM MÁQUINA AGORA · ${escaparHtml(item.emMaquinaAgora)}</span>`
                : "",
            !item.encontradoNoCatalogo
                ? `<span class="pcp-tag pcp-tag-erro">SEM CATÁLOGO</span>`
                : ""
        ].join("");

        const botoesMover = `
            <button type="button" class="pcp-btn-mover" title="Mover pra cima"
                data-mover="up" data-linha="${numeroLinha}" data-etapa="${etapa}" data-indice="${i}"
                ${i === 0 ? "disabled" : ""}>▲</button>
            <button type="button" class="pcp-btn-mover" title="Mover pra baixo"
                data-mover="down" data-linha="${numeroLinha}" data-etapa="${etapa}" data-indice="${i}"
                ${i === itens.length - 1 ? "disabled" : ""}>▼</button>
        `;

        return `
            <tr class="${item.emMaquinaAgora ? "pcp-atual" : ""} ${!item.encontradoNoCatalogo ? "pcp-item-sem-catalogo" : ""}">
                <td class="pcp-pos">${i + 1}</td>
                <td class="pcp-mover-col">${botoesMover}<span class="pcp-check-impressao"></span></td>
                <td class="strong">${escaparHtml(item.op)}${tags}</td>
                <td>${escaparHtml(item.codigoItem)}</td>
                <td>${escaparHtml(item.cor || "—")}</td>
                <td>${item.alturaDeDobra != null ? item.alturaDeDobra : "—"}</td>
                ${mostrarRoloDeFacas ? `<td>${item.eixo != null ? item.eixo + " facas" : "—"}</td>` : ""}
                <td>${escaparHtml(item.marcaPrivada || "—")}</td>
                <td>${escaparHtml(item.grupo || "—")}</td>
                <td>${item.qtdeItem ? item.qtdeItem.toLocaleString("pt-BR") : "—"}</td>
            </tr>
        `;
    }).join("");

    return `
        <div style="overflow-x:auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th class="pcp-mover-col"><span class="pcp-check-titulo">Feito</span></th>
                        <th>OP</th>
                        <th>Item</th>
                        <th>Cor</th>
                        <th>Altura</th>
                        ${mostrarRoloDeFacas ? "<th>Rolo de facas</th>" : ""}
                        <th>Marca privada</th>
                        <th>Grupo</th>
                        <th>Meta</th>
                    </tr>
                </thead>
                <tbody>${linhasHtml}</tbody>
            </table>
        </div>
    `;
}

function renderizarResumoMeta(numeroLinha, filas) {

    const partes = [];

    const meta = metasDiarias[numeroLinha] || 0;
    if (meta) {
        const totalFila = (filas.plissadeira ? somaQtdeItem(filas.plissadeira) : 0) + somaQtdeItem(filas.dosadora);
        const pct = Math.round((totalFila / meta) * 100);
        partes.push(`meta do dia: ${meta.toLocaleString("pt-BR")} peças · fila soma ${totalFila.toLocaleString("pt-BR")} peças (${pct}% da meta)`);
    }

    if (filas.setup) {
        const { trocasCor, trocasRolo, trocasAltura, minutos } = filas.setup;
        const detalhes = [
            trocasCor ? `${trocasCor} de cor` : "",
            trocasRolo ? `${trocasRolo} de rolo` : "",
            trocasAltura ? `${trocasAltura} de altura` : ""
        ].filter(Boolean).join(", ");
        partes.push(`setup estimado: ~${formatarMinutos(minutos)}${detalhes ? ` (${detalhes})` : ""}`);
    }

    return partes.length
        ? `<span class="pcp-meta-resumo">${partes.join(" · ")}</span>`
        : "";
}

// resumo geral no topo da página — visão rápida do dia inteiro antes de
// entrar linha por linha
function renderizarResumoGeral(filasPorLinha) {

    let totalOps = 0;
    let totalPecas = 0;
    let totalSemCatalogo = 0;
    let totalMinutosSetup = 0;

    Object.values(filasPorLinha).forEach(filas => {
        if (!filas) return;

        const todosOsItens = [
            ...(filas.plissadeira || []),
            ...(filas.dosadora || [])
        ];

        totalOps += todosOsItens.length;
        totalPecas += somaQtdeItem(todosOsItens);
        totalSemCatalogo += todosOsItens.filter(item => !item.encontradoNoCatalogo).length;

        if (filas.setup) totalMinutosSetup += filas.setup.minutos;
    });

    return `
        <section class="panel pcp-resumo-geral">
            <div class="pcp-resumo-geral-item">
                <span class="pcp-resumo-geral-valor">${totalOps}</span>
                <span class="pcp-resumo-geral-label">OPs sequenciadas hoje</span>
            </div>
            <div class="pcp-resumo-geral-item">
                <span class="pcp-resumo-geral-valor">${totalPecas.toLocaleString("pt-BR")}</span>
                <span class="pcp-resumo-geral-label">peças no total</span>
            </div>
            <div class="pcp-resumo-geral-item">
                <span class="pcp-resumo-geral-valor">~${formatarMinutos(totalMinutosSetup)}</span>
                <span class="pcp-resumo-geral-label">setup estimado (todas as linhas)</span>
            </div>
            <div class="pcp-resumo-geral-item ${totalSemCatalogo > 0 ? "pcp-resumo-geral-alerta" : ""}">
                <span class="pcp-resumo-geral-valor">${totalSemCatalogo}</span>
                <span class="pcp-resumo-geral-label">itens sem catálogo</span>
            </div>
        </section>
    `;
}

// =====================================================================
// SALVAR NO BANCO — pra tela do operador conseguir ler a sequência
// (card "Sequência de Produção", em minha_maquina.js). Cada geração
// nova substitui inteiramente a anterior daquela linha+etapa (apaga e
// grava de novo) — não fica lixo de gerações antigas acumulando.
// =====================================================================

async function salvarSequenciaNoBanco(filasPorLinha, dataAlvo) {

    const falhas = [];

    for (const nTexto of Object.keys(filasPorLinha)) {

        const n = Number(nTexto);
        const filas = filasPorLinha[n];
        if (!filas) continue;

        const etapas = filas.plissadeira === null
            ? [{ etapa: "dosadora", itens: filas.dosadora }]
            : [
                { etapa: "plissadeira", itens: filas.plissadeira },
                { etapa: "dosadora", itens: filas.dosadora }
            ];

        for (const { etapa, itens } of etapas) {
            const salvou = await salvarFilaNoBanco(n, etapa, dataAlvo, itens, false);
            if (!salvou) falhas.push(`Linha ${n} (${etapa})`);
        }
    }

    return falhas;
}

// salva UMA fila (linha+etapa+data) só — usada tanto pela geração
// automática (alteradoManualmente=false) quanto pelo reordenar manual
// do PCP (alteradoManualmente=true). Sempre apaga e grava de novo,
// nunca fica lixo de versão anterior daquela mesma combinação.
async function salvarFilaNoBanco(numeroLinha, etapa, dataAlvo, itens, alteradoManualmente) {

    const { error: erroDelete } = await supabaseClient
        .from(TABELAS.SEQUENCIA_PRODUCAO)
        .delete()
        .eq("numero_linha", numeroLinha)
        .eq("etapa", etapa)
        .eq("data", dataAlvo);

    if (erroDelete) {
        console.error(`Erro ao limpar sequência anterior (linha ${numeroLinha}, ${etapa}, ${dataAlvo}):`, erroDelete);
        return false;
    }

    if (!itens || !itens.length) return true;

    const registros = itens.map((item, i) => ({
        numero_linha: numeroLinha,
        etapa,
        data: dataAlvo,
        posicao: i + 1,
        op: item.op,
        codigo_item: item.codigoItem,
        qtde_item: item.qtdeItem || 0,
        cor: item.cor || null,
        altura_de_dobra: item.alturaDeDobra,
        eixo: item.eixo,
        em_maquina_agora: !!item.emMaquinaAgora,
        alterado_manualmente: alteradoManualmente
    }));

    const { error: erroInsert } = await supabaseClient
        .from(TABELAS.SEQUENCIA_PRODUCAO)
        .insert(registros);

    if (erroInsert) {
        console.error(`Erro ao salvar sequência (linha ${numeroLinha}, ${etapa}, ${dataAlvo}):`, erroInsert);
        return false;
    }

    return true;
}

function tagAjustadoManualmente(filas, etapa) {
    return filas.alteradoManualmente && filas.alteradoManualmente[etapa]
        ? '<span class="pcp-tag-manual">✋ ajustado manualmente</span>'
        : "";
}

function renderizarResultado(filasPorLinha, dataAlvo) {

    if (filtroLinhasSecao) filtroLinhasSecao.hidden = false;

    const numeros = [1, 2, 3, 4, 5].filter(n => linhasVisiveis.has(n));

    const tituloData = dataAlvo
        ? `<span class="pcp-data-alvo">sequência pra ${formatarDataBR(dataAlvo)}</span>`
        : "";

    // cada máquina sai numa folha própria na impressão — título com
    // linha/etapa/data no topo de cada uma, quebra de página entre elas
    let folhasAbertas = 0;
    const abrirFolha = (n, etapaNome) => {
        const dataTxt = dataAlvo ? ` · sequência pra ${formatarDataBR(dataAlvo)}` : "";
        return {
            classe: "panel pcp-maquina-folha" + (folhasAbertas++ === 0 ? " pcp-folha-primeira" : ""),
            titulo: `<div class="pcp-folha-titulo">Linha ${n} — ${etapaNome}${dataTxt}</div>`
        };
    };

    const linhasHtml = numeros.map(n => {

        const filas = filasPorLinha[n];
        const mostrarRoloDeFacas = n !== 4 && n !== 5;

        if (!filas) {
            return `
                <div class="pcp-linha-grupo pcp-nao-imprime">
                    <div class="pcp-linha-grupo-titulo">Linha ${n}</div>
                    <section class="panel"><div class="empty-message">Nenhuma OP pendente pra essa linha</div></section>
                </div>
            `;
        }

        // Linha 5: só Dosadora, sequenciamento direto
        if (filas.plissadeira === null) {
            const fDo = abrirFolha(n, "Dosadora");
            return `
                <div class="pcp-linha-grupo">
                    <div class="pcp-linha-grupo-titulo">Linha ${n} ${renderizarResumoMeta(n, filas)}</div>
                    <section class="${fDo.classe}">
                        ${fDo.titulo}
                        <div class="pcp-linha-header">
                            <span class="pcp-etapa-tag pcp-etapa-dosadora">Dosadora</span>
                            <span class="pcp-linha-resumo">${filas.dosadora.length} OP${filas.dosadora.length === 1 ? "" : "s"}</span>
                            ${tagAjustadoManualmente(filas, "dosadora")}
                        </div>
                        ${renderizarTabela(filas.dosadora, "Nenhuma OP pendente", mostrarRoloDeFacas, n, "dosadora")}
                    </section>
                </div>
            `;
        }

        const fPl = abrirFolha(n, "Plissadeira");
        const fDo = abrirFolha(n, "Dosadora");

        return `
            <div class="pcp-linha-grupo">
                <div class="pcp-linha-grupo-titulo">Linha ${n} ${renderizarResumoMeta(n, filas)}</div>

                <section class="${fPl.classe}">
                    ${fPl.titulo}
                    <div class="pcp-linha-header">
                        <span class="pcp-etapa-tag pcp-etapa-plissadeira">Plissadeira</span>
                        <span class="pcp-linha-resumo">${filas.plissadeira.length} OP${filas.plissadeira.length === 1 ? "" : "s"} na fila</span>
                        ${tagAjustadoManualmente(filas, "plissadeira")}
                    </div>
                    ${renderizarTabela(filas.plissadeira, "Nenhuma OP aguardando a Plissadeira", mostrarRoloDeFacas, n, "plissadeira")}
                </section>

                <section class="${fDo.classe}">
                    ${fDo.titulo}
                    <div class="pcp-linha-header">
                        <span class="pcp-etapa-tag pcp-etapa-dosadora">Dosadora</span>
                        <span class="pcp-linha-resumo">${filas.dosadora.length} pronta${filas.dosadora.length === 1 ? "" : "s"} pra finalizar</span>
                        ${tagAjustadoManualmente(filas, "dosadora")}
                    </div>
                    ${filas.semReferenciaPlissadeira
                        ? '<div class="empty-message">Não achei, na planilha importada, a OP que a Plissadeira está rodando agora — por segurança, nenhuma OP foi liberada pra Dosadora ainda. Confira se essa OP está na planilha.</div>'
                        : renderizarTabela(filas.dosadora, "Nenhuma OP pronta — nada saiu da Plissadeira ainda", mostrarRoloDeFacas, n, "dosadora")}
                </section>
            </div>
        `;
    }).join("");

    resultadoEl.innerHTML = tituloData + renderizarResumoGeral(filasPorLinha)
        + (numeros.length ? linhasHtml : '<div class="panel"><div class="empty-message">Nenhuma linha selecionada — marca pelo menos uma acima pra ver o resultado.</div></div>');
}


// =====================================================================
// REORDENAR MANUALMENTE — o PCP pode mover uma OP pra cima/baixo na
// fila depois de gerada. Cada movimento marca aquela linha+etapa como
// "ajustada manualmente" e já salva no banco na hora (não tem um botão
// "salvar edição" separado — o ajuste vale assim que é feito).
// =====================================================================

function formatarDataBR(dataISO) {
    const [ano, mes, dia] = dataISO.split("-");
    return `${dia}/${mes}/${ano}`;
}

resultadoEl.addEventListener("click", async evento => {

    const botao = evento.target.closest("[data-mover]");
    if (!botao || botao.disabled) return;

    const numeroLinha = Number(botao.dataset.linha);
    const etapa = botao.dataset.etapa;
    const indice = Number(botao.dataset.indice);
    const direcao = botao.dataset.mover;

    if (!filasPorLinhaAtual || !filasPorLinhaAtual[numeroLinha]) return;

    const filas = filasPorLinhaAtual[numeroLinha];
    const lista = filas[etapa];
    if (!lista) return;

    const indiceAlvo = direcao === "up" ? indice - 1 : indice + 1;
    if (indiceAlvo < 0 || indiceAlvo >= lista.length) return;

    // troca de posição, na hora
    [lista[indice], lista[indiceAlvo]] = [lista[indiceAlvo], lista[indice]];

    if (!filas.alteradoManualmente) filas.alteradoManualmente = { plissadeira: false, dosadora: false };
    filas.alteradoManualmente[etapa] = true;

    renderizarResultado(filasPorLinhaAtual, dataAlvoAtual);

    const salvou = await salvarFilaNoBanco(numeroLinha, etapa, dataAlvoAtual, lista, true);
    if (!salvou) {
        avisoEl.textContent = `Ordem mudou na tela, mas não consegui salvar a mudança (linha ${numeroLinha}, ${etapa}) — veja o console.`;
    }
});


// =====================================================================
// EVENTOS
// =====================================================================

function atualizarBotaoSequenciar() {
    btnSequenciar.disabled = !(catalogoMapa && opsLinhas);
}

// =====================================================================
// CARREGAMENTO INICIAL — catálogo de itens e metas diárias vêm do
// Supabase (cadastro do Administrador), carregados assim que a tela
// abre. Só a planilha de OPs do dia continua sendo importada aqui.
// =====================================================================

async function carregarCatalogoEMetas() {

    const [{ itens, erro: erroCatalogo }, metasCarregadas] = await Promise.all([
        buscarCatalogoItens(),
        buscarMetasDiarias()
    ]);

    metasDiarias = metasCarregadas;

    if (erroCatalogo) {
        catalogoMapa = null;
        statusCatalogo.textContent = "Erro ao carregar — veja o console";
        uploadCatalogoEl.classList.remove("pcp-upload-ok");
        avisoEl.textContent = "Não consegui carregar o catálogo de itens do banco. Confira a conexão ou fale com o Administrador.";
    } else {
        catalogoMapa = catalogoParaMapa(itens);
        statusCatalogo.textContent = `${catalogoMapa.size} itens cadastrados`;
        uploadCatalogoEl.classList.add("pcp-upload-ok");
    }

    atualizarBotaoSequenciar();
}

inputOps.addEventListener("change", async () => {

    const file = inputOps.files[0];
    if (!file) return;

    avisoEl.textContent = "";

    try {
        opsLinhas = await processarOps(file);
        statusOps.textContent = `${file.name} · ${opsLinhas.length} OPs`;
        uploadOpsEl.classList.add("pcp-upload-ok");
    } catch (erro) {
        console.error(erro);
        avisoEl.textContent = erro.message || "Erro ao ler as OPs.";
        opsLinhas = null;
        statusOps.textContent = "Nenhum arquivo";
        uploadOpsEl.classList.remove("pcp-upload-ok");
    }

    atualizarBotaoSequenciar();
});

btnSequenciar.addEventListener("click", async () => {

    avisoEl.textContent = "";
    btnSequenciar.disabled = true;
    const textoOriginal = btnSequenciar.textContent;
    btnSequenciar.textContent = "Gerando...";

    try {
        const dataAlvo = inputDataAlvo && inputDataAlvo.value ? inputDataAlvo.value : dataDeAmanha();
        localStorage.setItem(CHAVE_ULTIMA_DATA_PCP, dataAlvo);

        const maquinas = await buscarMaquinasAtuais();
        const { plissadeira: opsAtuaisPlissadeira, dosadora: opsAtuaisDosadora } = construirOpsAtuaisPorLinha(maquinas);

        const itens = montarItensSequenciaveis(opsLinhas, catalogoMapa);

        const porLinha = {};
        itens.forEach(item => {
            if (!item.numeroLinha) return;
            if (!porLinha[item.numeroLinha]) porLinha[item.numeroLinha] = [];
            porLinha[item.numeroLinha].push(item);
        });

        const semLinha = itens.filter(item => !item.numeroLinha).length;
        if (semLinha > 0) {
            avisoEl.textContent = `${semLinha} OP${semLinha === 1 ? "" : "s"} sem linha identificada na planilha — ficaram de fora.`;
        }

        const filasPorLinha = {};
        Object.keys(porLinha).forEach(nTexto => {
            const n = Number(nTexto);
            filasPorLinha[n] = montarFilasDaLinha(
                n,
                porLinha[n],
                opsAtuaisPlissadeira[n] || [],
                opsAtuaisDosadora[n] || []
            );
            // acabou de gerar automaticamente — ninguém foi editado à mão ainda
            filasPorLinha[n].alteradoManualmente = { plissadeira: false, dosadora: false };
        });

        // guarda em memória pra dar pra reordenar manualmente depois,
        // sem precisar gerar tudo de novo
        filasPorLinhaAtual = filasPorLinha;
        dataAlvoAtual = dataAlvo;

        renderizarResultado(filasPorLinha, dataAlvo);
        btnImprimir.hidden = false;

        // salva pra tela do operador conseguir ler (card de
        // sequenciamento em minha_maquina.js) — cada geração nova
        // substitui a anterior daquele dia por completo
        const falhasAoSalvar = await salvarSequenciaNoBanco(filasPorLinha, dataAlvo);

        if (falhasAoSalvar.length) {
            avisoEl.textContent = `Atenção: o sequenciamento apareceu na tela, mas NÃO foi salvo pra tela do operador ver — ${falhasAoSalvar.join(", ")}. Abra o console do navegador (F12) pra ver o erro exato.`;
        }

    } catch (erro) {
        console.error(erro);
        avisoEl.textContent = "Erro ao gerar o sequenciamento: " + (erro.message || "erro desconhecido");
    }

    btnSequenciar.disabled = false;
    btnSequenciar.textContent = textoOriginal;
});

btnImprimir.addEventListener("click", () => window.print());

// filtro de linhas — não regenera nada, só re-renderiza o que já está
// em memória (funciona tanto pra sequência recém-gerada quanto pra
// uma carregada do banco)
function rerenderizarComFiltro() {
    if (filasPorLinhaAtual) renderizarResultado(filasPorLinhaAtual, dataAlvoAtual);
}

checksFiltroLinha.forEach(check => {
    check.addEventListener("change", () => {
        const n = Number(check.value);
        if (check.checked) linhasVisiveis.add(n);
        else linhasVisiveis.delete(n);
        rerenderizarComFiltro();
    });
});

if (btnFiltroTodas) {
    btnFiltroTodas.addEventListener("click", () => {
        linhasVisiveis = new Set([1, 2, 3, 4, 5]);
        checksFiltroLinha.forEach(check => { check.checked = true; });
        rerenderizarComFiltro();
    });
}

if (btnFiltroNenhuma) {
    btnFiltroNenhuma.addEventListener("click", () => {
        linhasVisiveis = new Set();
        checksFiltroLinha.forEach(check => { check.checked = false; });
        rerenderizarComFiltro();
    });
}

setConexao("conectando");
carregarCatalogoEMetas();
if (inputDataAlvo && inputDataAlvo.value) carregarSequenciaExistente(inputDataAlvo.value);
