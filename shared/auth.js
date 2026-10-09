// =====================================================================
// CONTROLE DE ACESSO — operador / gestor / pcp
// =====================================================================
//
// Não existe backend de autenticação aqui — é um controle simples
// baseado em localStorage, o suficiente pra separar o que cada papel
// pode ver. Se um dia precisar de autenticação de verdade (senha,
// usuário), isso precisa ser trocado por um login real no Supabase.
//
// As senhas abaixo são validadas por HASH (SHA-256), não ficam em
// texto puro no código — mas isso NÃO é segurança de verdade: quem
// souber a senha ainda consegue entrar, e um hash SHA-256 sem "sal"
// pode ser quebrado por força bruta com ferramentas comuns se alguém
// realmente tentar. Serve só como uma barreira simples pro dia a dia.
// =====================================================================

const PAPEL_STORAGE_KEY = "ega_papel";

// hash SHA-256 da senha "gestor123" — TROQUE isso pela senha real que
// vocês querem usar. Pra gerar o hash de uma senha nova, rode no
// console do navegador:
//   await sha256Hex("sua-senha-aqui")
// e copie o resultado pra cá.
const SENHA_GESTOR_HASH =
    "18f2b94d784d03c222cb7c47148cdb8457f1ef3eaf3e317711f25d55747f6a35";

// hash SHA-256 da senha "pcp123" — TROQUE também, mesmo processo acima.
const SENHA_PCP_HASH =
    "6499ce50c9578e4fe9c15493b3ed27a58c1e33a0ac7d0569620682bffb590e46";

// hash SHA-256 da senha "admin2026!" — TROQUE por uma senha forte de
// verdade (esse papel edita metas e o catálogo de itens de todo mundo,
// merece uma senha mais cuidada que as outras).
const SENHA_ADMIN_HASH =
    "ea544d16cb34fa2d9a187c0784f0a58eda0cb147b34628611668efd869baf326";

async function sha256Hex(texto) {
    const dados = new TextEncoder().encode(texto);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dados);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

async function validarSenhaGestor(senha) {
    if (!senha) return false;
    const hash = await sha256Hex(senha);
    return hash === SENHA_GESTOR_HASH;
}

async function validarSenhaPcp(senha) {
    if (!senha) return false;
    const hash = await sha256Hex(senha);
    return hash === SENHA_PCP_HASH;
}

async function validarSenhaAdmin(senha) {
    if (!senha) return false;
    const hash = await sha256Hex(senha);
    return hash === SENHA_ADMIN_HASH;
}

function obterPapel() {
    return localStorage.getItem(PAPEL_STORAGE_KEY);
}

function definirPapel(papel) {
    localStorage.setItem(PAPEL_STORAGE_KEY, papel);
}

function sair() {
    localStorage.removeItem(PAPEL_STORAGE_KEY);
    window.location.href = "../index/index.html";
}

function paginaInicialDoPapel(papel) {
    if (papel === "operador") return "../maquinas/maquinas.html";
    if (papel === "pcp") return "../pcp/pcp.html";
    if (papel === "admin") return "../admin/admin.html";
    return "../gestor/gestor.html";
}

// =====================================================================
// exigirPapel(papeisPermitidos) — chamar no topo de cada página
// protegida. Se não tiver papel definido, manda pro login. Se tiver um
// papel que não pode ver essa página, manda pra home dele.
// =====================================================================

function exigirPapel(papeisPermitidos) {

    const papel = obterPapel();

    if (!papel) {
        window.location.href = "../index/index.html";
        return null;
    }

    if (!papeisPermitidos.includes(papel)) {
        window.location.href = paginaInicialDoPapel(papel);
        return null;
    }

    aplicarVisibilidadePorPapel(papel);

    return papel;
}

// =====================================================================
// Mostra/esconde itens do menu conforme o papel logado, e adiciona o
// botão de Sair no topbar de qualquer página protegida.
//
// Cada link do menu declara quem pode vê-lo com
// data-visivel-para="gestor" ou data-visivel-para="gestor,pcp" (lista
// separada por vírgula). Um link sem esse atributo fica sempre visível
// pra qualquer papel logado (ex.: "Máquinas", que todo mundo vê).
// =====================================================================

function aplicarVisibilidadePorPapel(papel) {

    document.querySelectorAll("[data-visivel-para]").forEach(el => {
        const permitidos = el.dataset.visivelPara.split(",").map(p => p.trim());
        el.style.display = permitidos.includes(papel) ? "" : "none";
    });

    const topbarRight = document.querySelector(".topbar-right");
    if (topbarRight && !document.getElementById("btn-sair")) {

        const botaoSair = document.createElement("button");
        botaoSair.id = "btn-sair";
        botaoSair.className = "btn";
        botaoSair.textContent = "Sair";
        botaoSair.addEventListener("click", sair);
        topbarRight.appendChild(botaoSair);
    }
}
