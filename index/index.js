// =====================================================================
// LOGIN — seleção de papel (Operador / Gestor / PCP)
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

// =====================================================================
// Gestor e PCP: clique revela a senha — mesma lógica pros dois cards,
// só troca o papel, o validador de senha e os elementos do DOM.
// =====================================================================

function configurarCardComSenha({ papel, idCard, idSeta, idSenhaArea, idInput, idBotaoEntrar, idErro, validarSenha }) {

    const card = document.getElementById(idCard);
    const senhaArea = document.getElementById(idSenhaArea);
    const seta = document.getElementById(idSeta);
    const input = document.getElementById(idInput);
    const botaoEntrar = document.getElementById(idBotaoEntrar);
    const erro = document.getElementById(idErro);

    if (!card) return;

    card.addEventListener("click", () => {

        if (!senhaArea.hidden) return;

        senhaArea.hidden = false;
        card.classList.add("acesso-opcao-gestor-aberto");
        if (seta) seta.hidden = true;
        input.focus();
    });

    async function tentarEntrar() {

        const senha = input.value;
        const senhaValida = await validarSenha(senha);

        if (!senhaValida) {
            erro.hidden = false;
            input.value = "";
            input.focus();
            return;
        }

        erro.hidden = true;
        definirPapel(papel);
        window.location.href = paginaInicialDoPapel(papel);
    }

    if (botaoEntrar) {
        botaoEntrar.addEventListener("click", evento => {
            evento.stopPropagation();
            tentarEntrar();
        });
    }

    if (input) {
        input.addEventListener("keydown", evento => {
            if (evento.key === "Enter") {
                evento.preventDefault();
                tentarEntrar();
            }
        });

        // clicar no campo de senha não deve "clicar" no card por baixo
        input.addEventListener("click", evento => evento.stopPropagation());
    }
}

configurarCardComSenha({
    papel: "gestor",
    idCard: "card-gestor",
    idSeta: "seta-gestor",
    idSenhaArea: "senha-area",
    idInput: "input-senha-gestor",
    idBotaoEntrar: "btn-entrar-gestor",
    idErro: "senha-erro",
    validarSenha: validarSenhaGestor
});

configurarCardComSenha({
    papel: "pcp",
    idCard: "card-pcp",
    idSeta: "seta-pcp",
    idSenhaArea: "senha-area-pcp",
    idInput: "input-senha-pcp",
    idBotaoEntrar: "btn-entrar-pcp",
    idErro: "senha-erro-pcp",
    validarSenha: validarSenhaPcp
});

configurarCardComSenha({
    papel: "admin",
    idCard: "card-admin",
    idSeta: null,
    idSenhaArea: "senha-area-admin",
    idInput: "input-senha-admin",
    idBotaoEntrar: "btn-entrar-admin",
    idErro: "senha-erro-admin",
    validarSenha: validarSenhaAdmin
});

// se já tiver um papel escolhido antes, pula direto pra página dele
const papelAtual = obterPapel();
if (papelAtual) {
    window.location.href = paginaInicialDoPapel(papelAtual);
}
