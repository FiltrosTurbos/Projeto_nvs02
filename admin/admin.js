// =====================================================================
// TELA: Administrador — metas diárias e catálogo de itens
// =====================================================================

exigirPapel(["admin"]);


// =====================================================================
// ELEMENTOS
// =====================================================================

const connectionPill = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");

const metasGrid = document.getElementById("admin-metas-grid");
const btnSalvarMetas = document.getElementById("btn-salvar-metas");
const metasAviso = document.getElementById("admin-metas-aviso");

const catalogoResumo = document.getElementById("admin-catalogo-resumo");
const inputImport = document.getElementById("input-catalogo-import");
const importStatus = document.getElementById("admin-import-status");

const formItem = document.getElementById("form-item");
const btnSalvarItem = document.getElementById("btn-salvar-item");
const btnCancelarEdicao = document.getElementById("btn-cancelar-edicao");
const itemAviso = document.getElementById("admin-item-aviso");

const inputBusca = document.getElementById("input-busca-catalogo");
const tabelaCorpo = document.getElementById("tabela-catalogo-corpo");

let catalogoAtual = [];


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


// =====================================================================
// UTILITÁRIOS (mesmo padrão usado no Sequenciador)
// =====================================================================

function normalizarTexto(valor) {
    return String(valor ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();
}

function escaparHtml(texto) {
    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function extrairNumeroLinha(valor) {
    const m = String(valor ?? "").match(/(\d)/);
    return m ? Number(m[1]) : null;
}


// =====================================================================
// METAS DIÁRIAS POR LINHA
// =====================================================================

async function carregarMetas() {

    const metas = await buscarMetasDiarias();

    metasGrid.innerHTML = [1, 2, 3, 4, 5].map(n => `
        <label class="admin-meta-item">
            Linha ${n} (peças/dia)
            <input type="number" min="0" step="1" class="admin-meta-input" data-linha="${n}" value="${metas[n] || 0}">
        </label>
    `).join("");
}

btnSalvarMetas.addEventListener("click", async () => {

    metasAviso.textContent = "";
    btnSalvarMetas.disabled = true;

    const linhas = [1, 2, 3, 4, 5].map(n => {
        const input = metasGrid.querySelector(`[data-linha="${n}"]`);
        return { numero_linha: n, meta_pecas: Number(input.value) || 0 };
    });

    const { error } = await supabaseClient
        .from(TABELAS.METAS_DIARIAS)
        .upsert(linhas, { onConflict: "numero_linha" });

    btnSalvarMetas.disabled = false;

    if (error) {
        console.error(error);
        metasAviso.textContent = "Erro ao salvar: " + error.message;
        return;
    }

    metasAviso.textContent = "Metas salvas!";
    setTimeout(() => { metasAviso.textContent = ""; }, 3000);
});


// =====================================================================
// ÍNDICES DE CLASSIFICAÇÃO (produção e OEE)
// =====================================================================

const indicesGrid = document.getElementById("admin-indices-grid");
const btnSalvarIndices = document.getElementById("btn-salvar-indices");
const indicesAviso = document.getElementById("admin-indices-aviso");

const ROTULOS_INDICES = {
    producao: "Índice de produção (cards de hora / Ritmo)",
    oee: "Índice de OEE"
};

async function carregarIndices() {

    const config = await carregarIndicesConfig();

    indicesGrid.innerHTML = Object.keys(ROTULOS_INDICES).map(chave => `
        <div class="admin-indice-item">
            <span class="admin-indice-titulo">${ROTULOS_INDICES[chave]}</span>
            <div class="admin-indice-campos">
                <label class="admin-meta-item">
                    Verde a partir de (%)
                    <input type="number" min="0" max="100" step="1" class="admin-indice-input" data-chave="${chave}" data-campo="bom" value="${config[chave].bom}">
                </label>
                <label class="admin-meta-item">
                    Amarelo a partir de (%)
                    <input type="number" min="0" max="100" step="1" class="admin-indice-input" data-chave="${chave}" data-campo="atencao" value="${config[chave].atencao}">
                </label>
            </div>
        </div>
    `).join("");
}

btnSalvarIndices.addEventListener("click", async () => {

    indicesAviso.textContent = "";
    btnSalvarIndices.disabled = true;

    const chaves = Object.keys(ROTULOS_INDICES);

    const registros = chaves.map(chave => {
        const inputBom = indicesGrid.querySelector(`[data-chave="${chave}"][data-campo="bom"]`);
        const inputAtencao = indicesGrid.querySelector(`[data-chave="${chave}"][data-campo="atencao"]`);
        return {
            chave,
            limite_bom: Number(inputBom.value) || 0,
            limite_atencao: Number(inputAtencao.value) || 0
        };
    });

    const invalido = registros.find(r => r.limite_atencao > r.limite_bom);
    if (invalido) {
        indicesAviso.textContent = `O limite de amarelo não pode ser maior que o de verde (${ROTULOS_INDICES[invalido.chave]}).`;
        btnSalvarIndices.disabled = false;
        return;
    }

    const { error } = await supabaseClient
        .from(TABELAS.INDICES_CONFIG)
        .upsert(registros, { onConflict: "chave" });

    btnSalvarIndices.disabled = false;

    if (error) {
        console.error(error);
        indicesAviso.textContent = "Erro ao salvar: " + error.message;
        return;
    }

    indicesAviso.textContent = "Índices salvos!";
    setTimeout(() => { indicesAviso.textContent = ""; }, 3000);
});


// =====================================================================
// CATÁLOGO — LISTAGEM E BUSCA
// =====================================================================

async function carregarCatalogo() {

    const { itens, erro } = await buscarCatalogoItens();

    if (erro) {
        catalogoResumo.textContent = "Erro ao carregar catálogo — veja o console.";
        setConexao("erro");
        return;
    }

    setConexao("online");
    catalogoAtual = itens;
    catalogoResumo.textContent = `${itens.length} itens cadastrados`;
    renderizarTabelaCatalogo();
}

function renderizarTabelaCatalogo() {

    const termo = normalizarTexto(inputBusca.value);

    const filtrados = termo
        ? catalogoAtual.filter(item => normalizarTexto(item.codigo_item).includes(termo))
        : catalogoAtual;

    if (!filtrados.length) {
        tabelaCorpo.innerHTML = `<tr><td colspan="9" class="empty-message">Nenhum item encontrado</td></tr>`;
        return;
    }

    tabelaCorpo.innerHTML = filtrados.map(item => `
        <tr>
            <td class="strong">${escaparHtml(item.codigo_item)}</td>
            <td>${escaparHtml(item.grupo || "—")}</td>
            <td>${escaparHtml(item.cor || "—")}</td>
            <td>${escaparHtml(item.marca_privada || "—")}</td>
            <td>${item.altura_de_dobra != null ? item.altura_de_dobra : "—"}</td>
            <td>${escaparHtml(item.papel || "—")}</td>
            <td>${item.numero_linha != null ? "Linha " + item.numero_linha : "—"}</td>
            <td>${escaparHtml(item.observacoes || "—")}</td>
            <td>
                <button class="btn-icon" data-editar="${escaparHtml(item.codigo_item)}">Editar</button>
                <button class="btn-icon btn-icon-perigo" data-excluir="${escaparHtml(item.codigo_item)}">Excluir</button>
            </td>
        </tr>
    `).join("");
}

inputBusca.addEventListener("input", renderizarTabelaCatalogo);


// =====================================================================
// CATÁLOGO — EDITAR / EXCLUIR (delegação de evento na tabela)
// =====================================================================

function preencherFormularioParaEdicao(item) {

    document.getElementById("item-codigo-original").value = item.codigo_item;
    document.getElementById("item-codigo").value = item.codigo_item;
    document.getElementById("item-grupo").value = item.grupo || "";
    document.getElementById("item-cor").value = item.cor || "";
    document.getElementById("item-marca").value = item.marca_privada || "";
    document.getElementById("item-altura").value = item.altura_de_dobra ?? "";
    document.getElementById("item-papel").value = item.papel || "";
    document.getElementById("item-linha").value = item.numero_linha ?? "";
    document.getElementById("item-observacoes").value = item.observacoes || "";

    btnSalvarItem.textContent = "Salvar edição";
    btnCancelarEdicao.hidden = false;

    formItem.scrollIntoView({ behavior: "smooth", block: "start" });
}

function limparFormularioItem() {
    formItem.reset();
    document.getElementById("item-codigo-original").value = "";
    btnSalvarItem.textContent = "Adicionar item";
    btnCancelarEdicao.hidden = true;
}

btnCancelarEdicao.addEventListener("click", limparFormularioItem);

async function excluirItem(codigo) {

    const { error } = await supabaseClient
        .from(TABELAS.CATALOGO_ITENS)
        .delete()
        .eq("codigo_item", codigo);

    if (error) {
        alert("Erro ao excluir: " + error.message);
        return;
    }

    await carregarCatalogo();
}

tabelaCorpo.addEventListener("click", evento => {

    const botaoEditar = evento.target.closest("[data-editar]");
    const botaoExcluir = evento.target.closest("[data-excluir]");

    if (botaoEditar) {
        const codigo = botaoEditar.dataset.editar;
        const item = catalogoAtual.find(i => i.codigo_item === codigo);
        if (item) preencherFormularioParaEdicao(item);
    }

    if (botaoExcluir) {
        const codigo = botaoExcluir.dataset.excluir;
        if (confirm(`Excluir o item "${codigo}" do catálogo? Essa ação não pode ser desfeita.`)) {
            excluirItem(codigo);
        }
    }
});


// =====================================================================
// CATÁLOGO — ADICIONAR / EDITAR (formulário)
// =====================================================================

formItem.addEventListener("submit", async evento => {

    evento.preventDefault();
    itemAviso.textContent = "";

    const codigoOriginal = document.getElementById("item-codigo-original").value;
    const codigo = normalizarTexto(document.getElementById("item-codigo").value);

    if (!codigo) {
        itemAviso.textContent = "Código do item é obrigatório.";
        return;
    }

    const linha = document.getElementById("item-linha").value;
    const altura = document.getElementById("item-altura").value;

    const registro = {
        codigo_item: codigo,
        grupo: document.getElementById("item-grupo").value.trim() || null,
        cor: document.getElementById("item-cor").value.trim() || null,
        marca_privada: document.getElementById("item-marca").value.trim() || null,
        altura_de_dobra: altura !== "" ? Number(altura) : null,
        papel: document.getElementById("item-papel").value.trim() || null,
        numero_linha: linha !== "" ? Number(linha) : null,
        observacoes: normalizarTexto(document.getElementById("item-observacoes").value) || null
    };

    btnSalvarItem.disabled = true;

    // se o código mudou durante uma edição, o registro antigo (chave
    // primária antiga) precisa sumir — upsert não "move" uma chave
    if (codigoOriginal && codigoOriginal !== codigo) {
        await supabaseClient.from(TABELAS.CATALOGO_ITENS).delete().eq("codigo_item", codigoOriginal);
    }

    const { error } = await supabaseClient
        .from(TABELAS.CATALOGO_ITENS)
        .upsert(registro, { onConflict: "codigo_item" });

    btnSalvarItem.disabled = false;

    if (error) {
        console.error(error);
        itemAviso.textContent = "Erro ao salvar: " + error.message;
        return;
    }

    limparFormularioItem();
    await carregarCatalogo();
});


// =====================================================================
// CATÁLOGO — IMPORTAÇÃO EM MASSA (.xlsx)
// =====================================================================

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

async function processarPlanilhaCatalogo(file) {

    const matriz = await lerMatrizXlsx(file);
    const idxCabecalho = acharLinhaCabecalho(matriz, ["CODIGO DO ITEM", "PRODUTO"]);

    if (idxCabecalho === -1) {
        throw new Error('Não achei a coluna "Código do Item" (ou "Produto") nessa planilha.');
    }

    const cabecalho = matriz[idxCabecalho];

    const col = {
        codigo: acharColuna(cabecalho, ["CODIGO DO ITEM", "PRODUTO"]),
        grupo: acharColuna(cabecalho, ["GRUPO"]),
        cor: acharColuna(cabecalho, ["COR"]),
        marcaPrivada: acharColuna(cabecalho, ["MARCA PRIVADA", "MARCA"]),
        alturaDeDobra: acharColuna(cabecalho, ["ALTURA DE DOBRA", "ALT. DOBRAS", "ALT DOBRAS", "ALTURA"]),
        papel: acharColuna(cabecalho, ["PAPEL"]),
        observacoes: acharColuna(cabecalho, ["OBSERVAC"]),
        linha: acharColuna(cabecalho, ["LINHA"])
    };

    const registros = [];

    for (let i = idxCabecalho + 1; i < matriz.length; i++) {

        const linha = matriz[i];
        if (!linha || col.codigo === -1) continue;

        const codigo = normalizarTexto(linha[col.codigo]);
        if (!codigo) continue;

        registros.push({
            codigo_item: codigo,
            grupo: col.grupo !== -1 ? (String(linha[col.grupo] ?? "").trim() || null) : null,
            cor: col.cor !== -1 ? (String(linha[col.cor] ?? "").trim() || null) : null,
            marca_privada: col.marcaPrivada !== -1 ? (String(linha[col.marcaPrivada] ?? "").trim() || null) : null,
            altura_de_dobra: col.alturaDeDobra !== -1 && linha[col.alturaDeDobra] != null
                ? Number(linha[col.alturaDeDobra])
                : null,
            papel: col.papel !== -1 ? (String(linha[col.papel] ?? "").trim() || null) : null,
            numero_linha: col.linha !== -1 ? extrairNumeroLinha(linha[col.linha]) : null,
            observacoes: col.observacoes !== -1 ? (normalizarTexto(linha[col.observacoes]) || null) : null
        });
    }

    if (!registros.length) {
        throw new Error("A planilha não tem nenhuma linha de item válida.");
    }

    return registros;
}

inputImport.addEventListener("change", async () => {

    const file = inputImport.files[0];
    if (!file) return;

    importStatus.textContent = "Lendo planilha...";

    try {
        const registros = await processarPlanilhaCatalogo(file);

        importStatus.textContent = `Enviando ${registros.length} itens...`;

        // upsert em lotes — evita mandar um payload gigante de uma vez
        const TAMANHO_LOTE = 200;
        for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {

            const lote = registros.slice(i, i + TAMANHO_LOTE);

            const { error } = await supabaseClient
                .from(TABELAS.CATALOGO_ITENS)
                .upsert(lote, { onConflict: "codigo_item" });

            if (error) throw new Error(error.message);
        }

        importStatus.textContent = `${registros.length} itens importados/atualizados com sucesso!`;
        await carregarCatalogo();

    } catch (erro) {
        console.error(erro);
        importStatus.textContent = "Erro: " + (erro.message || "erro desconhecido");
    }

    inputImport.value = "";
});


// =====================================================================
// INICIALIZAÇÃO
// =====================================================================

setConexao("conectando");
carregarMetas();
carregarIndices();
carregarCatalogo();
