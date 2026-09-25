# Night Cruise

Jogo de cruzeiro noturno em 3D no navegador, inspirado nas vias expressas de Tóquio (Shuto Expressway).
Escolha um carro JDM, a cor, e rode pelo anel elevado, pontes e túneis costurando o trânsito.

**Jogar:** abra a página do GitHub Pages deste repositório (computador, teclado ou controle).

## Controles

| Ação | Teclado |
|---|---|
| Acelerar / frear | W / S ou ↑ / ↓ |
| Esterçar | A / D ou ← / → |
| Olhar para os lados | Q / E |
| Olhar para trás | C |
| Mapa | M |
| Câmera | V |
| Faróis | L |
| Buzina | H |
| Voltar para a pista | R |
| Pausa | Esc |

Todas as teclas podem ser trocadas em Configurações.

## Publicar uma nova versão

O jogo não tem etapa de build: o GitHub Pages publica a raiz da branch `main` como está.
A versão fica em dois lugares, e os dois devem ser iguais:

- `js/version.js`: `VERSION`, `DATE`, `COMMIT` e `MODELS_REV` (o que aparece no menu inicial e na pausa);
- `index.html`: `var V = '…'` no script de carregamento (é a chave de cache dos arquivos do jogo).

Passo a passo (exemplo para a versão `1.5.0`):

1. **Número da versão.** Em `js/version.js` troque `VERSION` para `'1.5.0'` e, em `index.html`, troque `var V = '1.4.0'` para `var V = '1.5.0'`.
2. **Data.** Em `js/version.js` troque `DATE` para a data da publicação, no formato `AAAA-MM-DD`.
   Deixe `COMMIT = ''` por enquanto (é preenchido no passo 5).
3. **Novidades.** Acrescente a versão no topo da lista em `js/changelog.js` (versão, data e 3 a 5 linhas).
4. **Cache.**
   - Arquivos em `js/`: nada a fazer além do passo 1. O `index.html` carrega `js/main.js?v=1.5.0` e cria
     um *import map* que aponta cada módulo do jogo para `js/<arquivo>.js?v=1.5.0`. O navegador aplica
     esse mapa a todos os `import` dentro dos módulos, então nenhum `import` precisa ser editado.
     Se criar um arquivo novo em `js/`, acrescente o nome dele em `MODULES` no `index.html`
     (se esquecer, o jogo funciona, mas o console avisa que o arquivo carregou sem `?v`).
   - Modelos em `models/`: só se algum arquivo lá mudou, aumente `MODELS_REV` em `js/version.js`
     (por exemplo de `'1'` para `'2'`). Assim os jogadores só baixam os modelos de novo quando eles mudam.
5. **Commits.** Um commit não consegue conter o próprio código, por isso são dois:
   ```sh
   git add -A
   git commit -m "v1.5.0: <resumo>"
   git rev-parse --short=7 HEAD      # código curto do commit acima, ex.: abc1234
   ```
   Coloque esse código em `COMMIT` no `js/version.js` e faça o segundo commit, só com essa linha:
   ```sh
   git add js/version.js
   git commit -m "v1.5.0: registra o commit abc1234 na versão"
   ```
6. **Push.**
   ```sh
   git push origin main
   ```
7. **Conferir.** O GitHub Pages publica em alguns minutos (acompanhe em *Actions* no GitHub).
   Abra https://souapenasjunior.github.io/night-cruise/ (se precisar, `Ctrl+F5`) e confira no canto
   superior direito do menu inicial, e no menu de pausa, o texto `v1.5.0 · <data> · <código>`.
   No console do navegador (F12) não deve aparecer nenhum aviso `Night Cruise:` sobre a versão.

## Créditos

Feito com [three.js](https://threejs.org/).
Modelos 3D dos carros do Sketchfab, licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
otimizados e adaptados para o jogo. A lista completa de autores está na tela **Créditos** do jogo.
Nomes e marcas dos veículos pertencem aos respectivos fabricantes.
