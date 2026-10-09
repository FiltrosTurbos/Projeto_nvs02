# Como publicar esse painel numa página web

Essa pasta (`web/`) é um site **100% estático** — só HTML, CSS e JS puro,
sem build, sem servidor próprio. Ela fala direto com o Supabase pelo
navegador. Não precisa de Node, não precisa de `npm install`, não
precisa de nada além de subir os arquivos.

**Importante:** só suba a pasta `web/`. A pasta `sync/` é um serviço à
parte (roda com Node, continuamente, conectado ao SQL Server) — ela
**não** vai nessa hospedagem, continua rodando de onde já está rodando
hoje (a máquina/servidor que você já usa pra isso).

## Opção mais simples — Netlify (arrastar e soltar)

1. Entre em https://app.netlify.com/drop
2. Arraste a pasta `web/` inteira pra lá.
3. Pronto — já tem uma URL pública funcionando.

## Netlify conectado ao Git (deploy automático a cada push)

Se preferir conectar o repositório inteiro (com `sync/` e tudo mais)
direto no Netlify, em vez de arrastar só a pasta `web/`:

1. No Netlify: "Add new site" → "Import an existing project" → escolha
   o repositório.
2. Não precisa configurar nada na tela de build — já tem um
   `netlify.toml` na raiz do projeto dizendo pra publicar só a pasta
   `web/` (e não rodar nenhum build, já que é HTML/CSS/JS puro).
3. Todo push na branch principal já atualiza o site sozinho.

## Vercel

```
cd web
vercel deploy --prod
```

(Se não tiver a CLI: `npm i -g vercel` primeiro, ou use o site vercel.com
e importe a pasta.)

## Qualquer servidor próprio (Apache, Nginx, IIS, etc.)

Copie o conteúdo da pasta `web/` inteiro pra dentro da pasta pública do
site (ex.: `/var/www/html`, `wwwroot`, `public_html`). Não precisa de
nenhuma configuração especial de rotas — é tudo link direto entre
páginas (`gestor/gestor.html`, `supervisor/supervisor.html`, etc.).

## Domínio próprio

Depois de publicar em qualquer uma das opções acima, todas oferecem
"Add custom domain" nas configurações — é só apontar o DNS do seu
domínio pra lá.

## Depois de publicar

- A página inicial (`/`) já redireciona sozinha pra tela de login
  (`index/index.html`).
- O painel lê os dados direto do Supabase (a chave já está configurada
  em `shared/supabaseClient.js` — é a chave pública/"anon", segura pra
  ficar exposta no navegador, só permite leitura).
- Continue rodando o `sync.js` de onde ele já roda hoje — é ele quem
  mantém o Supabase atualizado com o que vem do EGA. Publicar o `web/`
  não substitui isso.
