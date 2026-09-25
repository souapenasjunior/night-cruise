// "Novidades" screen: one entry per release, newest first. Plain text, 3 to 5 lines each.
export const CHANGELOG = [
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
