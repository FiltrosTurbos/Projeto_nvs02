// =====================================================================
// LOGIN — seleção de papel (Operador / Gestor)
// =====================================================================

// ---- Relógio ao vivo ----

const relogioEl = document.getElementById("login-relogio");
const dataEl = document.getElementById("login-data");

function atualizarRelogio() {

    const agora = new Date();

    if (relogioEl) {
        relogioEl.textContent = agora.toLocaleTimeString("pt-BR");
    }

    if (dataEl) {
        dataEl.textContent = agora.toLocaleDateString(
            "pt-BR",
            { weekday: "short", day: "2-digit", month: "short" }
        );
    }
}

atualizarRelogio();
setInterval(atualizarRelogio, 1000);

// ---- Operador: entra direto, sem senha ----

document.querySelectorAll("[data-selecionar-papel]").forEach(botao => {

    botao.addEventListener("click", () => {

        const papel = botao.dataset.selecionarPapel;

        definirPapel(papel);

        window.location.href = paginaInicialDoPapel(papel);
    });
});

// ---- Gestor: clique revela a senha ----

const cardGestor = document.getElementById("card-gestor");
const senhaArea = document.getElementById("senha-area");
const setaGestor = document.getElementById("seta-gestor");
const inputSenhaGestor = document.getElementById("input-senha-gestor");
const botaoEntrarGestor = document.getElementById("btn-entrar-gestor");
const senhaErro = document.getElementById("senha-erro");

if (cardGestor) {
    cardGestor.addEventListener("click", () => {

        if (!senhaArea.hidden) return;

        senhaArea.hidden = false;
        cardGestor.classList.add("acesso-opcao-gestor-aberto");
        if (setaGestor) setaGestor.hidden = true;
        inputSenhaGestor.focus();
    });
}

async function tentarEntrarComoGestor() {

    const senha = inputSenhaGestor.value;

    const senhaValida = await validarSenhaGestor(senha);

    if (!senhaValida) {
        senhaErro.hidden = false;
        inputSenhaGestor.value = "";
        inputSenhaGestor.focus();
        return;
    }

    senhaErro.hidden = true;
    definirPapel("gestor");
    window.location.href = paginaInicialDoPapel("gestor");
}

if (botaoEntrarGestor) {
    botaoEntrarGestor.addEventListener("click", tentarEntrarComoGestor);
}

if (inputSenhaGestor) {
    inputSenhaGestor.addEventListener("keydown", evento => {
        if (evento.key === "Enter") {
            evento.preventDefault();
            tentarEntrarComoGestor();
        }
    });

    // clicar no campo de senha não deve "clicar" no card por baixo
    inputSenhaGestor.addEventListener("click", evento => evento.stopPropagation());
    botaoEntrarGestor.addEventListener("click", evento => evento.stopPropagation());
}

// se já tiver um papel escolhido antes, pula direto pra página dele
const papelAtual = obterPapel();
if (papelAtual) {
    window.location.href = paginaInicialDoPapel(papelAtual);
}
