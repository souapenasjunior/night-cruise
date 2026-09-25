// "Novidades" screen: one entry per release, newest first. Plain text, 3 to 5 lines each.
export const CHANGELOG = [
  {
    version: '1.7.0', date: '2026-09-25',
    lines: [
      'As pistas amarelas (ligação C2 e suas rampas) saíram do mapa; o anel K1 agora é contínuo, sem essas entradas e saídas.',
      'Bem menos placas: ficam só os nomes das regiões e a sinalização do estacionamento Nishi PA.',
      'Entrada e saída do PA redesenhadas nos dois sentidos: curvas longas e suaves que dão para fazer em alta velocidade, sem grampo nem retorno.',
      'Quem vem pelo sentido externo passa por baixo do anel e entra pela outra ponta do PA; a pista do PA é mão dupla.',
    ],
  },
  {
    version: '1.6.0', date: '2026-09-25',
    lines: [
      'Pistas sem acostamento: só uma faixa estreita entre a última faixa e a mureta, no anel, no C2, nas rampas e no PA.',
      'O trânsito agora roda só no anel K1; C2, rampas e PA ficam livres para você.',
      'Asfalto mais nítido de perto, com textura em resolução maior e grão fino em todas as pistas.',
      'No menu principal só tocam os sons do menu, sem motor nem barulho da pista.',
      'Controles: botões do controle remapeáveis, qualquer comando pode ser removido, mapa no D-pad ↓ e lista de comandos no menu de pausa.',
    ],
  },
  {
    version: '1.5.1', date: '2026-09-25',
    lines: [
      'Acostamento dos dois lados do anel: agora também há 3,1 m livres junto à mureta central, e um carro parado cabe inteiro em qualquer lado.',
      'Faixas pintadas no chão não piscam mais onde uma rampa entra ou sai do anel e na entrada dos boxes do PA.',
      'Carros do trânsito só mudam da faixa de aceleração para a pista quando ela já corre ao lado, sem cruzar o acostamento.',
    ],
  },
  {
    version: '1.5.0', date: '2026-09-25',
    lines: [
      'Acostamento largo no mapa inteiro: 3,1 m livres no anel e 2,4 m no C2, nas rampas e no PA; dá para parar ou passar por ele.',
      'Junções niveladas: onde duas pistas se encontram o chão é um só, sem degrau, tranco nem piso tremendo.',
      'Muretas refeitas: exatamente na borda da pista, sem sobreposição nem lascas, pontas inclinadas nos bicos.',
      'Toda mureta que se vê tem colisão, e o carro não atravessa mais nenhuma, nem com a frente nas curvas fechadas.',
      'Pilares, postes e placas não atravessam mais pistas, e toda passagem inferior tem ao menos 4,5 m de altura livre.',
    ],
  },
  {
    version: '1.4.0', date: '2026-09-25',
    lines: [
      'Nova tela de Novidades no menu inicial, com o que mudou em cada versão.',
      'Versão do jogo, data e código do commit no canto do menu inicial e da pausa.',
      'Cada atualização baixa os arquivos novos do jogo, sem ficar presa em arquivos antigos do navegador.',
    ],
  },
  {
    version: '1.3.1', date: '2026-09-24',
    lines: [
      'Junções do Nishi PA corrigidas: o chão das rampas agora fica nivelado com a via de acesso.',
      'Muretas sem sobreposição: onde duas pistas correm lado a lado só uma mureta é desenhada.',
      'Ao lado das vagas do PA a mureta da via de acesso termina reta, junto à parede do estacionamento.',
    ],
  },
  {
    version: '1.3.0', date: '2026-09-24',
    lines: [
      'Nishi PA acessível pelos dois sentidos do anel K1, com entrada e saída próprias.',
      'Ligações do C2 nos dois sentidos, com retorno depois da junção; o trânsito também usa as novas rampas.',
      'Placas novas calculadas pelo mapa: verdes para direções, azuis para o PA e painel luminoso só para avisos.',
      'Pintura no chão: setas nas faixas de saída, zebrado nas bifurcações e linhas nas faixas de entrada e saída.',
    ],
  },
];
